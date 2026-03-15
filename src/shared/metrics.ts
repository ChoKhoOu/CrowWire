import { Registry, Counter, Histogram, Gauge } from 'prom-client';

export const registry = new Registry();

// Pipeline counters
export const eventsIngestedTotal = new Counter({
  name: 'crowwire_events_ingested_total',
  help: 'Total events ingested from RSS feeds',
  labelNames: ['source_name'] as const,
  registers: [registry],
});

export const eventsDeduplicated = new Counter({
  name: 'crowwire_events_deduplicated_total',
  help: 'Total events deduplicated',
  labelNames: ['strategy'] as const,
  registers: [registry],
});

export const eventsScoredTotal = new Counter({
  name: 'crowwire_events_scored_total',
  help: 'Total events scored',
  labelNames: ['routing'] as const,
  registers: [registry],
});

export const eventsDeliveredTotal = new Counter({
  name: 'crowwire_events_delivered_total',
  help: 'Total events delivered',
  labelNames: ['bundle_type', 'success'] as const,
  registers: [registry],
});

export const dedupChecksTotal = new Counter({
  name: 'crowwire_dedup_checks_total',
  help: 'Total dedup checks performed',
  labelNames: ['result', 'strategy'] as const,
  registers: [registry],
});

export const feedErrorsTotal = new Counter({
  name: 'crowwire_feed_errors_total',
  help: 'Total feed errors',
  labelNames: ['feed_name'] as const,
  registers: [registry],
});

export const modelApiErrorsTotal = new Counter({
  name: 'crowwire_model_api_errors_total',
  help: 'Total model API errors',
  labelNames: ['error_type'] as const,
  registers: [registry],
});

// Histograms
export const scoringDuration = new Histogram({
  name: 'crowwire_scoring_duration_seconds',
  help: 'Scoring latency in seconds',
  buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10],
  registers: [registry],
});

export const deliveryDuration = new Histogram({
  name: 'crowwire_delivery_duration_seconds',
  help: 'Delivery latency in seconds',
  buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10],
  registers: [registry],
});

// Gauges
export const queueDepth = new Gauge({
  name: 'crowwire_queue_depth',
  help: 'Current queue depth',
  labelNames: ['queue_name'] as const,
  registers: [registry],
});

export const dlqDepth = new Gauge({
  name: 'crowwire_dlq_depth',
  help: 'Dead letter queue depth',
  labelNames: ['queue_name'] as const,
  registers: [registry],
});

export const feedPaused = new Gauge({
  name: 'crowwire_feed_paused',
  help: 'Whether a feed is paused (1=paused)',
  labelNames: ['feed_name'] as const,
  registers: [registry],
});

export const circuitBreakerState = new Gauge({
  name: 'crowwire_circuit_breaker_state',
  help: 'Circuit breaker state (0=closed, 1=open)',
  labelNames: ['service'] as const,
  registers: [registry],
});
