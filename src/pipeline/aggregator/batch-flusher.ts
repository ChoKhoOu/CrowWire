import type { Job } from 'bullmq';
import { getQueues } from '../../queue/queues.js';
import { createChildLogger } from '../../shared/logger.js';
import { getEnv } from '../../config/env.js';
import { buildBundle } from './aggregator.js';
import { summarizeBatch } from './summarizer.js';
import type { DeliveryPayload } from '../../types/delivery.js';

const log = createChildLogger({ module: 'batch-flusher' });

export async function processBatchFlush(job: Job): Promise<void> {
  log.debug('Running batch flush');

  const bundle = await buildBundle('batch');
  if (!bundle) return; // No events, no-op

  const env = getEnv();
  // Use summarizer (AI for large batches, structured text for small)
  const message = await summarizeBatch(bundle.events);

  const payload: DeliveryPayload = {
    message,
    name: 'CrowWire',
    agentId: 'main',
    wakeMode: 'now',
    deliver: true,
    channel: env.OPENCLAW_DELIVERY_CHANNEL,
    _bundle: bundle,
  };

  // Strip full events from job payload — message is already formatted
  const jobPayload = {
    payload: {
      ...payload,
      _bundle: { ...bundle, events: [] },
    },
  };

  // Enqueue to deliver queue
  const { deliver } = getQueues();
  await deliver.add(`deliver:${bundle.bundle_id}`, jobPayload, {
    attempts: 5,
    backoff: { type: 'exponential', delay: 5000 },
  });

  log.info({ bundleId: bundle.bundle_id, eventCount: bundle.event_count }, 'Batch bundle enqueued for delivery');
}
