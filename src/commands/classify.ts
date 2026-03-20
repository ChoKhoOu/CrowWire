import { invokeTool } from '../lib/invoke.js';
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
  threshold: number = 75,
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
    let summaryDegradedCount = 0;

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
            const summary = await generateMergeSummary(group);
            if (summary) {
              group.mergedSummary = summary;
            } else {
              summaryDegradedCount++;
            }
          }
        }

        if (summaryDegradedCount > 0) {
          process.stderr.write(
            `[DEGRADED] ${summaryDegradedCount} merge summary(s) failed — falling back to snippet joining\n`,
          );
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

async function generateMergeSummary(group: EventGroup): Promise<string | undefined> {
  const sourcesBlock = group.members
    .map(m => `- ${m.source}: ${m.title} -- ${m.content.slice(0, 200)}`)
    .join('\n');

  const prompt = `用2-3句话简洁总结以下多个来源报道的同一新闻事件（中文输出）：\n${sourcesBlock}`;

  try {
    const { output, transport } = await invokeTool({
      tool: 'llm-task',
      action: 'json',
      args: { prompt, input: '', timeoutMs: MERGE_SUMMARY_TIMEOUT_MS },
      timeoutMs: MERGE_SUMMARY_TIMEOUT_MS,
    });

    process.stderr.write(`[info] Merge summary via ${transport} transport\n`);

    const parsed = JSON.parse(output.trim());
    const text = typeof parsed === 'string' ? parsed : (parsed.output ?? parsed.result ?? '');
    if (typeof text === 'string' && text.trim().length > 0) {
      return text.trim();
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[warn] LLM merge summary failed: ${msg}\n`);
  }

  return undefined;
}
