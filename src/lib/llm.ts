import { createLlmClient, LlmClient } from './llm-client.js';
import { createNewsXmlParser, mergeXmlScores } from './xml-parser.js';
import type { ParsedNewsItem } from './xml-parser.js';
import { DEFAULT_SCORES } from './scoring-utils.js';
import type { FeedItem, ScoredItem } from '../types.js';

const BATCH_SIZE = 30;

const SCORING_PROMPT = `You are a news analyst. For each news item:
1. Score it:
   - urgency (0-100): How time-sensitive? Breaking events score 90+.
   - relevance (0-100): How important to a tech/finance professional?
   - novelty (0-100): How surprising or new is this information?
2. Write a summary in Chinese (30-150 characters). It MUST add context or details beyond the title — do NOT repeat or rephrase the title.

Return your response as XML using EXACTLY these tags and no others:
<news_list>
  <news>
    <id>{item id}</id>
    <scores>
      <urgency>{0-100}</urgency>
      <relevance>{0-100}</relevance>
      <novelty>{0-100}</novelty>
    </scores>
    <summary>{Chinese summary}</summary>
  </news>
</news_list>

IMPORTANT:
- Use ONLY the tags shown above. Do not add any other XML tags.
- Do NOT wrap the output in markdown code fences or any other formatting.
- Output the XML directly with no preamble or explanation.`;

let client: LlmClient | null = null;

function getLlmClient(): LlmClient {
  if (!client) client = createLlmClient();
  return client;
}

/** Reset the lazy singleton — for testing only */
export function _resetLlmClient(): void {
  client = null;
}

export async function scoreBatch(items: FeedItem[], blacklist?: string[]): Promise<ScoredItem[]> {
  if (items.length === 0) return [];

  const batches = chunk(items, BATCH_SIZE);
  const results: ScoredItem[] = [];

  for (const batch of batches) {
    const scored = await scoreSingleBatch(batch, blacklist);
    results.push(...scored);
  }

  return results;
}

async function scoreSingleBatch(items: FeedItem[], blacklist?: string[]): Promise<ScoredItem[]> {
  const input = items.map(i => ({
    id: i.id,
    title: i.title,
    link: i.link,
    content: i.content,
    published_at: i.published_at,
    source: i.source,
  }));

  const userMessage = JSON.stringify(input);

  let prompt = SCORING_PROMPT;
  if (blacklist && blacklist.length > 0) {
    if (blacklist.length > 50) {
      process.stderr.write(`[filter] Warning: ${blacklist.length} blacklist categories may impact LLM response quality\n`);
    }
    prompt += `\n\nAlso evaluate each item against these blacklist categories:\n${blacklist.map((c, i) => `${i + 1}. ${c}`).join('\n')}\nFor each item, add a <blacklist> block inside <news>:\n<blacklist>\n  <hit>true or false</hit>\n  <reason>matched category description or empty</reason>\n</blacklist>`;
  }

  try {
    const parsed: ParsedNewsItem[] = [];
    const parser = createNewsXmlParser(item => parsed.push(item));

    await getLlmClient().chatCompletionStream(prompt, userMessage, (chunk) => {
      parser.write(chunk);
    });
    parser.end();

    // Zero-item stream degradation logging
    if (parsed.length === 0) {
      process.stderr.write(
        `[DEGRADED] LLM stream produced zero parseable <news> items. ` +
        `${items.length} items have default scores and NO summary.\n`,
      );
      return items.map(item => ({ ...item, ...DEFAULT_SCORES }));
    }

    return mergeXmlScores(items, parsed);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `[DEGRADED] LLM scoring failed: ${msg}. ` +
      `${items.length} items have default scores and NO summary.\n`,
    );
    return items.map(item => ({
      ...item,
      ...DEFAULT_SCORES,
    }));
  }
}

// Re-export safeInt for backward compatibility (tests import from llm.js)
export { safeInt } from './scoring-utils.js';

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

