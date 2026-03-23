import { createLlmClient, LlmClient } from './llm-client.js';
import { createNewsXmlParser, mergeXmlScores } from './xml-parser.js';
import type { ParsedNewsItem } from './xml-parser.js';
import { DEFAULT_SCORES } from './scoring-utils.js';
import type { FeedItem, ScoredItem } from '../types.js';

const BATCH_SIZE = 30;

const SCORING_PROMPT = `You are a news analyst. You will receive a JSON array of FeedItem objects (id, title, link, content, published_at, source), up to 30 items per batch.

For each news item:
1. Score it:
   - urgency (0-100): How time-sensitive? Breaking events score 90+.
   - relevance (0-100): How important to a tech/finance professional?
   - novelty (0-100): How surprising or new is this information?
2. Write a summary in Chinese (30-150 characters).

## Summary Rules (CRITICAL)

Summary = 事实摘要, NOT 分析评论.

Structure: **[WHO/WHAT] + [DID WHAT] + [KEY DETAIL/NUMBER]**, optionally followed by one sentence of impact.

- MUST start with the concrete event/fact: who did what, what happened, what number changed.
- If the news contains specific numbers, prices, percentages, or dates, INCLUDE them.
- Impact/implication is OPTIONAL and must be ≤ 1 sentence, placed AFTER the fact.
- Do NOT write summaries that only contain analysis without stating the underlying fact.

### ONE-SHOT EXAMPLE

Input:
{"id":"n001","title":"以色列对伊朗发动大规模空袭，布什尔核电站附近传出爆炸","content":"当地时间周六凌晨，以色列对伊朗多处军事目标发动空袭，伊朗国家电视台报道布什尔省核电站附近区域传出爆炸声。伊朗石油部称Assaluyeh天然气设施未受影响。原油期货亚盘跳涨3.2%。PP期货盘中触及涨停。","source":"Reuters"}

GOOD summary:
以色列大规模空袭伊朗军事目标，布什尔核电站附近传出爆炸，伊方称天然气设施未受损。原油期货亚盘跳涨3.2%，PP期货盘中触及涨停。

BAD summary (DO NOT write like this):
若冲突从军事打击延伸到能源与核设施层面，潜在外溢后果将远超常规地缘摩擦。布什尔核电站一旦卷入，可能触发更强国际干预，并显著抬升原油与航运风险溢价。

Why BAD: Reader has no idea what actually happened. It reads like a think-tank report, not a news summary. No facts, no numbers, no event.

### MORE BAD PATTERNS (FORBIDDEN)
- "该新闻表明..." / "这表明..." — 你还没告诉我新闻内容就开始"表明"
- "若...则..." 开头的纯假设推演 — 先说事实
- "值得关注的是..." — 先说发生了什么
- 通篇无主语无事件，全是 "可能"、"或将"、"意味着"

Return your response as XML using EXACTLY these tags:
<news_list>
  <news>
    <id>{item id}</id>
    <scores>
      <urgency>{0-100}</urgency>
      <relevance>{0-100}</relevance>
      <novelty>{0-100}</novelty>
    </scores>
    <summary>{Chinese summary — 事实先行}</summary>
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

