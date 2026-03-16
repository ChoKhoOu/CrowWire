import { execSync } from 'node:child_process';
import {
  getDb, closeDb, bufferItem, drainBuffer,
  getLastDigestTime, updateLastDigestTime,
  getRecentSentEvents, recordSentEvent, cleanupExpiredSentEvents,
} from '../lib/db.js';
import { computePairwiseSimilarity } from '../lib/similarity.js';
import { groupByEvent } from '../lib/aggregator.js';
import type { ScoredItem, ClassifyOutput, EventGroup } from '../types.js';
import { readStdin } from './shared.js';

const MERGE_SUMMARY_TIMEOUT_MS = 30_000;

export async function runClassify(
  dbPath: string,
  threshold: number = 85,
  digestIntervalMinutes: number = 15,
  similarityThreshold: number = 0.55,
  sentEventTtlHours: number = 24,
): Promise<void> {
  const input = await readStdin();
  const items: ScoredItem[] = JSON.parse(input || '[]');

  const database = getDb(dbPath);

  try {
    const urgent: ScoredItem[] = [];
    let buffered = 0;

    // Load recent sent events for urgent dedup
    const recentSentEvents = getRecentSentEvents(database, sentEventTtlHours);

    for (const item of items) {
      if (item.urgency >= threshold) {
        // Urgent dedup: check similarity against recently sent events
        const isDuplicate = recentSentEvents.some(sent =>
          computePairwiseSimilarity(
            { title: item.title, content: item.content },
            { title: sent.title, content: sent.content },
          ) >= similarityThreshold
        );

        if (isDuplicate) {
          // Silent drop — same event already sent
          continue;
        }

        urgent.push(item);
        recordSentEvent(database, item.title, item.content);
      } else {
        bufferItem(database, JSON.stringify(item), item.relevance);
        buffered++;
      }
    }

    // Check if digest should flush
    const lastDigest = getLastDigestTime(database);
    const now = Date.now() / 1000 | 0;
    const elapsed = now - lastDigest;
    const intervalSeconds = digestIntervalMinutes * 60;

    let digest: ScoredItem[] = [];
    let digestFlushed = 0;
    let digestGroups: EventGroup[] | undefined;

    if (elapsed >= intervalSeconds) {
      const drained = drainBuffer(database);
      digest = drained.map(json => JSON.parse(json) as ScoredItem);
      digestFlushed = digest.length;
      if (digestFlushed > 0 || lastDigest === 0) {
        updateLastDigestTime(database);
      }

      // Group digest items by event similarity
      if (digest.length > 0) {
        digestGroups = groupByEvent(digest, similarityThreshold);

        // Generate LLM merge summaries for multi-source groups
        for (const group of digestGroups) {
          if (group.isMultiSource) {
            group.mergedSummary = generateMergeSummary(group);
          }
        }
      }
    }

    const output: ClassifyOutput = {
      urgent,
      digest,
      digestGroups,
      has_urgent: urgent.length > 0,
      has_digest: digest.length > 0,
      has_output: urgent.length > 0 || digest.length > 0,
      stats: {
        new_items: items.length,
        buffered,
        digest_flushed: digestFlushed,
      },
    };

    process.stdout.write(JSON.stringify(output));

    // Cleanup expired records
    cleanupExpiredSentEvents(database, sentEventTtlHours);
  } finally {
    closeDb();
  }
}

function generateMergeSummary(group: EventGroup): string {
  const sourcesBlock = group.members
    .map(m => `- ${m.source}: ${m.title} -- ${m.content.slice(0, 200)}`)
    .join('\n');

  const prompt = `用2-3句话简洁总结以下多个来源报道的同一新闻事件（中文输出）：\n${sourcesBlock}`;

  try {
    const argsJson = JSON.stringify({ prompt, input: '', timeoutMs: MERGE_SUMMARY_TIMEOUT_MS });
    const result = execSync(
      `openclaw.invoke --tool llm-task --action json --args-json '${argsJson.replace(/'/g, "'\\''")}'`,
      { timeout: MERGE_SUMMARY_TIMEOUT_MS + 5000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    const parsed = JSON.parse(result.trim());
    const text = typeof parsed === 'string' ? parsed : (parsed.output ?? parsed.result ?? '');
    if (typeof text === 'string' && text.trim().length > 0) {
      return text.trim();
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[warn] LLM merge summary failed: ${msg}\n`);
  }

  // Fallback: bullet-point titles
  return group.members.map(m => `- ${m.title}（${m.source}）`).join('\n');
}
