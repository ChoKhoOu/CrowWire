import type { Job } from 'bullmq';
import { buildBundle } from './aggregator.js';
import { summarizeBatch } from './summarizer.js';
import { enqueueBundleDeliveries } from './flush-bundle.js';
import { createChildLogger } from '../../shared/logger.js';

const log = createChildLogger({ module: 'batch-flusher' });

export async function processBatchFlush(_job: Job): Promise<void> {
  const bundle = await buildBundle('batch');
  if (!bundle) {
    log.debug('No batch events to flush');
    return;
  }

  const message = await summarizeBatch(bundle.events);
  await enqueueBundleDeliveries(bundle, message);
}
