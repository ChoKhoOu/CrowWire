import { createLlmClient, LlmClient } from './llm-client.js';
import type { FeedItem, ScoredItem } from '../types.js';

const BATCH_SIZE = 10;

const DEFAULT_SCORES = { urgency: 50, relevance: 50, novelty: 50 };

const SCORING_PROMPT = `You are a news analyst. For each news item:
1. Score it:
   - urgency (0-100): How time-sensitive? Breaking events score 90+.
   - relevance (0-100): How important to a tech/finance professional?
   - novelty (0-100): How surprising or new is this information?
2. Write a "summary" (string): A Chinese summary in 30-150 characters. It MUST add context or details beyond the title — do NOT repeat or rephrase the title. Focus on the key facts, numbers, or implications. More important news (higher urgency/relevance) deserves a longer, more detailed summary.

Return a JSON array with the same items, each having added "urgency", "relevance", "novelty" (integers) and "summary" (string) fields.`;

let client: LlmClient | null = null;

function getLlmClient(): LlmClient {
  if (!client) client = createLlmClient();
  return client;
}

/** Reset the lazy singleton — for testing only */
export function _resetLlmClient(): void {
  client = null;
}

export async function scoreBatch(items: FeedItem[]): Promise<ScoredItem[]> {
  if (items.length === 0) return [];

  const batches = chunk(items, BATCH_SIZE);
  const results: ScoredItem[] = [];

  for (const batch of batches) {
    const scored = await scoreSingleBatch(batch);
    results.push(...scored);
  }

  return results;
}

async function scoreSingleBatch(items: FeedItem[]): Promise<ScoredItem[]> {
  const input = items.map(i => ({
    id: i.id,
    title: i.title,
    link: i.link,
    content: i.content,
    published_at: i.published_at,
    source: i.source,
  }));

  const userMessage = JSON.stringify(input);

  try {
    // LlmClient handles retries internally (2 retries with exponential backoff)
    const scored = await getLlmClient().chatCompletionJson<Array<Record<string, unknown>>>(
      SCORING_PROMPT,
      userMessage,
    );

    const payload = Array.isArray(scored) ? scored : [];

    return mergeScores(items, payload);
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

function mergeScores(originals: FeedItem[], scored: Array<Record<string, unknown>>): ScoredItem[] {
  const scoreMap = new Map<string, Record<string, unknown>>();
  for (const s of scored) {
    if (s.id && typeof s.id === 'string') {
      scoreMap.set(s.id, s);
    }
  }

  return originals.map(item => {
    const s = scoreMap.get(item.id);
    return {
      ...item,
      urgency: safeInt(s?.urgency, DEFAULT_SCORES.urgency),
      relevance: safeInt(s?.relevance, DEFAULT_SCORES.relevance),
      novelty: safeInt(s?.novelty, DEFAULT_SCORES.novelty),
      summary: typeof s?.summary === 'string' && s.summary.trim() ? s.summary.trim() : undefined,
    };
  });
}

function safeInt(val: unknown, fallback: number): number {
  if (typeof val === 'number' && Number.isInteger(val) && val >= 0 && val <= 100) {
    return val;
  }
  return fallback;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

