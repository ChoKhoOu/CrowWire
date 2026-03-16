import type { Job } from 'bullmq';
import { getRedisConnection } from '../../queue/connection.js';
import { getQueues } from '../../queue/queues.js';
import { getConfig } from '../../config/config.js';
import { REDIS_KEYS } from '../../config/constants.js';
import { createChildLogger } from '../../shared/logger.js';
import { ModelClient } from './model-client.js';
import { TransientError, PermanentError } from '../../types/errors.js';
import { eventsScoredTotal, scoringDuration, modelApiErrorsTotal } from '../../shared/metrics.js';
import { modelCircuitBreaker } from '../../shared/circuit-breaker.js';
import type { CrowWireEvent, ScoredEvent } from '../../types/event.js';

const log = createChildLogger({ module: 'scorer' });

let _modelClient: ModelClient | null = null;

function getModelClient(): ModelClient {
  if (!_modelClient) {
    _modelClient = new ModelClient();
  }
  return _modelClient;
}

interface ScoreJobData {
  event: CrowWireEvent;
}

export async function processScoreJob(job: Job<ScoreJobData>): Promise<void> {
  if (modelCircuitBreaker.isOpen()) {
    throw new TransientError('Circuit breaker open, refusing scoring request');
  }

  const { event: rawEvent } = job.data;
  const event: CrowWireEvent = {
    ...rawEvent,
    published_at: new Date(rawEvent.published_at),
    ingested_at: new Date(rawEvent.ingested_at),
  };
  const config = getConfig();

  log.info({ eventId: event.id, title: event.title }, 'Scoring event');

  const scoreTimer = scoringDuration.startTimer();

  try {
    // 1. Score with AI model
    const modelClient = getModelClient();
    const scoreResult = await modelClient.score(event);
    modelCircuitBreaker.recordSuccess();

    // 2. Route inline
    const routing = scoreResult.urgency_score >= config.scoring.urgent_threshold ? 'urgent' : 'batch';

    // 3. Build scored event
    const scoredEvent: ScoredEvent = {
      ...event,
      urgency_score: scoreResult.urgency_score,
      relevance_score: scoreResult.relevance_score,
      novelty_score: scoreResult.novelty_score,
      category_tags: scoreResult.category_tags,
      score_reason: scoreResult.reason,
      routing,
      scored_at: new Date(),
    };

    // 4. Accumulate into Redis bundle state (PostgreSQL persistence removed)
    const redis = getRedisConnection();
    const bundleType = routing;
    const metaKey = bundleType === 'urgent' ? REDIS_KEYS.BUNDLE_URGENT_META : REDIS_KEYS.BUNDLE_BATCH_META;
    const eventsKey = bundleType === 'urgent' ? REDIS_KEYS.BUNDLE_URGENT_EVENTS : REDIS_KEYS.BUNDLE_BATCH_EVENTS;

    const accumPipeline = redis.multi();
    accumPipeline.hincrby(metaKey, 'event_count', 1);
    accumPipeline.hset(metaKey, 'last_updated', Date.now().toString());
    accumPipeline.hsetnx(metaKey, 'created_at', Date.now().toString());
    accumPipeline.sadd(eventsKey, JSON.stringify(scoredEvent));
    await accumPipeline.exec();

    // 6. Check batch early flush threshold
    if (bundleType === 'batch') {
      const count = await redis.scard(eventsKey);
      if (count >= config.queue.batch_flush_count_threshold) {
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

    if (error instanceof PermanentError) {
      modelApiErrorsTotal.inc({ error_type: 'permanent' });
      log.error({ eventId: event.id, err: error }, 'Permanent scoring error');
      throw error;
    }

    modelCircuitBreaker.recordFailure();
    modelApiErrorsTotal.inc({ error_type: 'transient' });

    if (error instanceof TransientError) {
      log.warn({ eventId: event.id, err: error }, 'Transient scoring error, will retry');
      throw error;
    }
    log.error({ eventId: event.id, err: error }, 'Unexpected scoring error');
    throw new TransientError(`Scoring failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
