import { createHash } from 'crypto';
import { uuidv7 } from 'uuidv7';
import { getRedisConnection } from '../../queue/connection.js';
import { REDIS_KEYS } from '../../config/constants.js';
import { createChildLogger } from '../../shared/logger.js';
import type { ScoredEvent } from '../../types/event.js';
import type { EventBundle } from '../../types/delivery.js';

const log = createChildLogger({ module: 'aggregator' });

export async function buildBundle(bundleType: 'urgent' | 'batch'): Promise<EventBundle | null> {
  const redis = getRedisConnection();
  const eventsKey = bundleType === 'urgent' ? REDIS_KEYS.BUNDLE_URGENT_EVENTS : REDIS_KEYS.BUNDLE_BATCH_EVENTS;

  // Read all events from Redis SET
  const eventJsons = await redis.smembers(eventsKey);
  if (eventJsons.length === 0) {
    log.debug({ bundleType }, 'No events in bundle, skipping flush');
    return null;
  }

  const events: ScoredEvent[] = eventJsons.map(json => {
    const parsed = JSON.parse(json);
    return {
      ...parsed,
      published_at: new Date(parsed.published_at),
      ingested_at: new Date(parsed.ingested_at),
      scored_at: new Date(parsed.scored_at),
    };
  });

  // Sort events by urgency score descending
  events.sort((a, b) => b.urgency_score - a.urgency_score);

  // Generate idempotency key: SHA256(sorted event IDs)
  const sortedIds = events.map(e => e.id).sort();
  const idempotencyKey = createHash('sha256').update(sortedIds.join(',')).digest('hex');

  // Collect all unique tags
  const allTags = [...new Set(events.flatMap(e => [...e.tags, ...e.category_tags]))];

  const bundle: EventBundle = {
    bundle_id: uuidv7(),
    idempotency_key: idempotencyKey,
    bundle_type: bundleType,
    created_at: new Date(),
    event_count: events.length,
    events,
    tags: allTags,
  };

  log.info({ bundleId: bundle.bundle_id, bundleType, eventCount: events.length }, 'Bundle assembled');
  return bundle;
}

export async function clearBundleState(bundleType: 'urgent' | 'batch'): Promise<void> {
  const redis = getRedisConnection();
  const metaKey = bundleType === 'urgent' ? REDIS_KEYS.BUNDLE_URGENT_META : REDIS_KEYS.BUNDLE_BATCH_META;
  const eventsKey = bundleType === 'urgent' ? REDIS_KEYS.BUNDLE_URGENT_EVENTS : REDIS_KEYS.BUNDLE_BATCH_EVENTS;

  // Atomic delete via MULTI/EXEC
  const pipeline = redis.multi();
  pipeline.del(metaKey);
  pipeline.del(eventsKey);
  await pipeline.exec();

  log.debug({ bundleType }, 'Bundle state cleared');
}

export function formatStructuredText(events: ScoredEvent[]): string {
  const lines = events.map(e => {
    const tags = e.category_tags.join(', ');
    return `[${e.urgency_score}] ${e.title} — ${e.source_name} (${tags})`;
  });
  return lines.join('\n');
}
