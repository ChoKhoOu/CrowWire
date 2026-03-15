export const QUEUE_NAMES = {
  INGEST: 'ingest_queue',
  SCORE: 'score_queue',
  AGGREGATE: 'aggregate_queue',
  DELIVER: 'deliver_queue',
} as const;

export const REDIS_KEYS = {
  BUNDLE_URGENT_META: 'bundle:urgent:current',
  BUNDLE_URGENT_EVENTS: 'bundle:urgent:current:events',
  BUNDLE_BATCH_META: 'bundle:batch:current',
  BUNDLE_BATCH_EVENTS: 'bundle:batch:current:events',
  FEED_ERRORS_PREFIX: 'feed:errors:',
  DEDUP_PREFIX: 'dedup:',
} as const;

export const DEFAULTS = {
  MAX_FEED_CONSECUTIVE_FAILURES: 10,
  MAX_REDIRECT_HOPS: 5,
  DELIVERY_TIMEOUT_MS: 10000,
  DELIVERY_MAX_ATTEMPTS: 5,
  DELIVERY_BACKOFF_BASE_MS: 5000,
  GRACEFUL_SHUTDOWN_TIMEOUT_MS: 30000,
  CIRCUIT_BREAKER_WINDOW_MS: 60000,
  CIRCUIT_BREAKER_THRESHOLD: 0.5,
  CIRCUIT_BREAKER_PAUSE_MS: 30000,
} as const;
