import type { Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import { events } from '../../db/schema.js';
import { getRedisConnection } from '../../queue/connection.js';
import { getQueues } from '../../queue/queues.js';
import { getEnv } from '../../config/env.js';
import { REDIS_KEYS } from '../../config/constants.js';
import { createChildLogger } from '../../shared/logger.js';
import { ModelClient } from './model-client.js';
import { TransientError, PermanentError } from '../../types/errors.js';
import { eventsScoredTotal, scoringDuration, modelApiErrorsTotal } from '../../shared/metrics.js';
import type { CrowWireEvent, ScoredEvent } from '../../types/event.js';

const log = createChildLogger({ module: 'scorer' });

let _modelClient: ModelClient | null = null;

function getModelClient(): ModelClient {
  if (!_modelClient) {
    const env = getEnv();
    _modelClient = new ModelClient({
      apiKey: env.ANTHROPIC_API_KEY,
      model: env.SCORING_MODEL,
    });
  }
  return _modelClient;
}

interface ScoreJobData {
  event: CrowWireEvent;
}

export async function processScoreJob(job: Job<ScoreJobData>): Promise<void> {
  const { event } = job.data;
  const env = getEnv();

  log.info({ eventId: event.id, title: event.title }, 'Scoring event');

  const scoreTimer = scoringDuration.startTimer();

  try {
    // 1. Score with AI model
    const modelClient = getModelClient();
    const scoreResult = await modelClient.score(event);

    // 2. Route inline
    const routing = scoreResult.urgency_score >= env.URGENT_SCORE_THRESHOLD ? 'urgent' : 'batch';

    // 3. Build scored event
    const scoredEvent: ScoredEvent = {
      ...event,
      // Ensure dates are Date objects (may be strings from job serialization)
      published_at: new Date(event.published_at),
      ingested_at: new Date(event.ingested_at),
      urgency_score: scoreResult.urgency_score,
      relevance_score: scoreResult.relevance_score,
      novelty_score: scoreResult.novelty_score,
      category_tags: scoreResult.category_tags,
      score_reason: scoreResult.reason,
      routing,
      scored_at: new Date(),
    };

    // 4. Persist to Postgres
    const db = getDb();
    await db.insert(events).values({
      id: scoredEvent.id,
      source_type: scoredEvent.source_type,
      source_name: scoredEvent.source_name,
      source_route: scoredEvent.source_route,
      guid: scoredEvent.guid,
      canonical_url: scoredEvent.canonical_url,
      title: scoredEvent.title,
      summary: scoredEvent.summary,
      content: scoredEvent.content,
      published_at: scoredEvent.published_at,
      ingested_at: scoredEvent.ingested_at,
      identity_hash: scoredEvent.identity_hash,
      content_hash: scoredEvent.content_hash,
      tags: scoredEvent.tags,
      urgency_score: scoredEvent.urgency_score,
      relevance_score: scoredEvent.relevance_score,
      novelty_score: scoredEvent.novelty_score,
      category_tags: scoredEvent.category_tags,
      score_reason: scoredEvent.score_reason,
      routing: scoredEvent.routing,
      scored_at: scoredEvent.scored_at,
    }).onConflictDoNothing();

    // 5. Accumulate into Redis bundle state
    const redis = getRedisConnection();
    const bundleType = routing;
    const metaKey = bundleType === 'urgent' ? REDIS_KEYS.BUNDLE_URGENT_META : REDIS_KEYS.BUNDLE_BATCH_META;
    const eventsKey = bundleType === 'urgent' ? REDIS_KEYS.BUNDLE_URGENT_EVENTS : REDIS_KEYS.BUNDLE_BATCH_EVENTS;

    await redis.hincrby(metaKey, 'event_count', 1);
    await redis.hset(metaKey, 'last_updated', Date.now().toString());
    if (!(await redis.hexists(metaKey, 'created_at'))) {
      await redis.hset(metaKey, 'created_at', Date.now().toString());
    }
    await redis.sadd(eventsKey, JSON.stringify(scoredEvent));

    // 6. Check batch early flush threshold
    if (bundleType === 'batch') {
      const count = await redis.scard(eventsKey);
      if (count >= env.BATCH_FLUSH_COUNT_THRESHOLD) {
        const { aggregate } = getQueues();
        const minuteBucket = Math.floor(Date.now() / 60000);
        await aggregate.add(`batch-early-flush:${minuteBucket}`, { bundleType: 'batch' }, {
          jobId: `batch-early-flush:${minuteBucket}`,
        });
        log.info({ count }, 'Batch early flush triggered');
      }
    }

    scoreTimer();
    eventsScoredTotal.inc({ routing });

    log.info({
      eventId: event.id,
      urgency: scoreResult.urgency_score,
      routing,
    }, 'Event scored and routed');

  } catch (error) {
    scoreTimer();
    modelApiErrorsTotal.inc({ error_type: error instanceof PermanentError ? 'permanent' : 'transient' });

    if (error instanceof PermanentError) {
      log.error({ eventId: event.id, err: error }, 'Permanent scoring error');
      throw error;
    }
    if (error instanceof TransientError) {
      log.warn({ eventId: event.id, err: error }, 'Transient scoring error, will retry');
      throw error;
    }
    log.error({ eventId: event.id, err: error }, 'Unexpected scoring error');
    throw new TransientError(`Scoring failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
