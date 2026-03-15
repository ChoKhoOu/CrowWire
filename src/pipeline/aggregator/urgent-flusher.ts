import type { Job } from 'bullmq';
import { getQueues } from '../../queue/queues.js';
import { createChildLogger } from '../../shared/logger.js';
import { getEnv } from '../../config/env.js';
import { buildBundle, clearBundleState, formatStructuredText } from './aggregator.js';
import type { DeliveryPayload } from '../../types/delivery.js';

const log = createChildLogger({ module: 'urgent-flusher' });

export async function processUrgentFlush(job: Job): Promise<void> {
  log.debug('Running urgent flush');

  const bundle = await buildBundle('urgent');
  if (!bundle) return; // No events, no-op

  const env = getEnv();
  // Urgent bundles: no summarization, use structured text
  const message = formatStructuredText(bundle.events);

  const payload: DeliveryPayload = {
    message,
    name: 'CrowWire',
    agentId: 'main',
    wakeMode: 'now',
    deliver: true,
    channel: env.OPENCLAW_DELIVERY_CHANNEL,
    _bundle: bundle,
  };

  // Enqueue to deliver queue
  const { deliver } = getQueues();
  await deliver.add(`deliver:${bundle.bundle_id}`, { payload }, {
    attempts: 5,
    backoff: { type: 'exponential', delay: 5000 },
  });

  log.info({ bundleId: bundle.bundle_id, eventCount: bundle.event_count }, 'Urgent bundle enqueued for delivery');

  // Only clear after delivery job is confirmed enqueued
  await clearBundleState('urgent');
}
