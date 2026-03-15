import { getQueues } from '../../queue/queues.js';
import { getConfig } from '../../config/config.js';
import { createChildLogger } from '../../shared/logger.js';
import type { EventBundle } from '../../types/delivery.js';
import type { FlushPayload, DeliverJobData } from '../../types/delivery.js';

const log = createChildLogger({ module: 'flush-bundle' });

export async function enqueueBundleDeliveries(
  bundle: EventBundle,
  message: string,
): Promise<void> {
  const config = getConfig();
  const { deliver } = getQueues();

  const enabledTargets = config.delivery.targets.filter(t => t.enabled);
  if (enabledTargets.length === 0) {
    log.warn({ bundleId: bundle.bundle_id }, 'No enabled delivery targets');
    return;
  }

  const maxUrgency = Math.max(...bundle.events.map(e => e.urgency_score));
  const payload: FlushPayload = {
    bundle: { ...bundle, events: [] },
    message,
  };

  for (const target of enabledTargets) {
    if (maxUrgency < target.filter.min_urgency) {
      log.debug({ targetName: target.name, maxUrgency, minRequired: target.filter.min_urgency }, 'Skipping target due to urgency filter');
      continue;
    }

    const jobData: DeliverJobData = {
      target_name: target.name,
      target_type: target.type,
      payload,
    };

    await deliver.add(`deliver:${bundle.bundle_id}:${target.name}`, jobData, {
      attempts: 5,
      backoff: { type: 'exponential', delay: 5000 },
    });

    log.info({ targetName: target.name, bundleId: bundle.bundle_id }, 'Enqueued bundle delivery job');
  }

  log.info({ bundleId: bundle.bundle_id, targetCount: enabledTargets.length, bundleType: bundle.bundle_type }, 'All delivery jobs enqueued for bundle');
}
