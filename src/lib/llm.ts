import { execSync } from 'node:child_process';
import { getInvokeShim } from './invoke.js';
import type { FeedItem, ScoredItem } from '../types.js';

const BATCH_SIZE = 10;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 3000;
const TIMEOUT_MS = 60_000;

const DEFAULT_SCORES = { urgency: 50, relevance: 50, novelty: 50 };

const SCORING_PROMPT = `You are a news analyst. For each news item:
1. Score it:
   - urgency (0-100): How time-sensitive? Breaking events score 90+.
   - relevance (0-100): How important to a tech/finance professional?
   - novelty (0-100): How surprising or new is this information?
2. Write a "summary" (string): A Chinese summary in 30-150 characters. It MUST add context or details beyond the title — do NOT repeat or rephrase the title. Focus on the key facts, numbers, or implications. More important news (higher urgency/relevance) deserves a longer, more detailed summary.

Return a JSON array with the same items, each having added "urgency", "relevance", "novelty" (integers) and "summary" (string) fields.`;

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

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const argsJson = JSON.stringify({
        prompt: SCORING_PROMPT,
        input: JSON.stringify(input),
        timeoutMs: TIMEOUT_MS,
      });

      const result = execSync(
        `${getInvokeShim()} --tool llm-task --action json --args-json '${argsJson.replace(/'/g, "'\\''")}'`,
        { timeout: TIMEOUT_MS + 5000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      );

      const parsed = JSON.parse(result.trim());
      const scored = Array.isArray(parsed) ? parsed : (parsed.output ?? parsed.result ?? []);

      return mergeScores(items, scored);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[warn] LLM scoring attempt ${attempt + 1}/${MAX_RETRIES + 1} failed: ${msg}\n`);

      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS);
      }
    }
  }

  // Total failure — assign default scores
  process.stderr.write(`[warn] LLM scoring failed after ${MAX_RETRIES + 1} attempts. Using default scores.\n`);
  return items.map(item => ({
    ...item,
    ...DEFAULT_SCORES,
  }));
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

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
