import type { Job } from 'bullmq';
import { buildBundle, formatStructuredText } from './aggregator.js';
import { enqueueBundleDeliveries } from './flush-bundle.js';
import { createChildLogger } from '../../shared/logger.js';

const log = createChildLogger({ module: 'urgent-flusher' });

export async function processUrgentFlush(_job: Job): Promise<void> {
  const bundle = await buildBundle('urgent');
  if (!bundle) {
    log.debug('No urgent events to flush');
    return;
  }

  const message = formatStructuredText(bundle.events);
  await enqueueBundleDeliveries(bundle, message);
}
