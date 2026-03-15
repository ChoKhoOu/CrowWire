import type { Job } from 'bullmq';
import { getQueues } from '../../queue/queues.js';
import { getRedisConnection } from '../../queue/connection.js';
import { REDIS_KEYS, DEFAULTS } from '../../config/constants.js';
import { createChildLogger } from '../../shared/logger.js';
import { parseRssFeed } from './rss-parser.js';
import { fetchRSSHubFeed } from './rsshub-client.js';
import { normalize } from '../normalizer/normalizer.js';
import { deduplicate } from '../deduper/deduper.js';
import { TransientError, PermanentError } from '../../types/errors.js';
import { eventsIngestedTotal, dedupChecksTotal, feedErrorsTotal } from '../../shared/metrics.js';
import type { FeedConfig } from '../../types/feed.js';

const log = createChildLogger({ module: 'ingestor' });

interface IngestJobData {
  feedName: string;
  feedConfig: FeedConfig;
}

export async function processIngestJob(job: Job<IngestJobData>): Promise<void> {
  const { feedName, feedConfig } = job.data;
  const redis = getRedisConnection();
  const { score } = getQueues();

  log.info({ feed: feedName, type: feedConfig.source_type }, 'Processing ingest job');

  try {
    // 1. Fetch raw items based on source type
    const rawItems = feedConfig.source_type === 'rsshub'
      ? await fetchRSSHubFeed(feedConfig.route!)
      : await parseRssFeed(feedConfig.url!);

    log.info({ feed: feedName, itemCount: rawItems.length }, 'Fetched raw items');

    let normalizedCount = 0;
    let duplicateCount = 0;
    let enqueuedCount = 0;

    // 2. Process each item: normalize -> dedup -> enqueue
    for (const raw of rawItems) {
      const event = normalize(raw, feedConfig);
      if (!event) continue;
      normalizedCount++;

      const dedupResult = await deduplicate(event);
      if (dedupResult.is_duplicate) {
        duplicateCount++;
        dedupChecksTotal.inc({ result: 'duplicate', strategy: dedupResult.matched_strategy || 'unknown' });
        continue;
      }
      dedupChecksTotal.inc({ result: 'new', strategy: 'none' });

      // 3. Enqueue to score queue
      await score.add(`score:${event.id}`, { event }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      });
      enqueuedCount++;
      eventsIngestedTotal.inc({ source_name: feedName });
    }

    // Reset error counter on success
    await redis.del(`${REDIS_KEYS.FEED_ERRORS_PREFIX}${feedName}`);

    log.info({
      feed: feedName,
      raw: rawItems.length,
      normalized: normalizedCount,
      duplicates: duplicateCount,
      enqueued: enqueuedCount,
    }, 'Ingest job completed');

  } catch (error) {
    // Track consecutive failures
    const errorKey = `${REDIS_KEYS.FEED_ERRORS_PREFIX}${feedName}`;
    const errorCount = await redis.incr(errorKey);
    await redis.expire(errorKey, 3600); // Reset counter after 1 hour of no errors

    feedErrorsTotal.inc({ feed_name: feedName });

    if (errorCount >= DEFAULTS.MAX_FEED_CONSECUTIVE_FAILURES) {
      log.warn({ feed: feedName, errorCount }, 'Feed paused due to consecutive failures');
      // Pause is handled by not re-throwing — BullMQ will not retry a completed job
      // The scheduler will still fire, but we check error count at the start
      return;
    }

    if (error instanceof PermanentError) {
      log.error({ feed: feedName, err: error }, 'Permanent ingest error');
      throw error; // Goes to DLQ
    }

    log.error({ feed: feedName, err: error, errorCount }, 'Transient ingest error');
    throw new TransientError(`Ingest failed for ${feedName}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
