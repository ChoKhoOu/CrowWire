import type { Job } from 'bullmq';
import { createChildLogger } from '../../shared/logger.js';
import { OpenClawAdapter } from './openclaw-adapter.js';
import { DiscordAdapter } from './discord-adapter.js';
import { getConfig } from '../../config/config.js';
import type { DeliverJobData } from '../../types/delivery.js';
import type { DeliveryAdapter } from './types.js';

const log = createChildLogger({ module: 'deliver-worker' });

const adapterCache = new Map<string, DeliveryAdapter>();

function getAdapter(targetName: string): DeliveryAdapter {
  const cached = adapterCache.get(targetName);
  if (cached) return cached;

  const config = getConfig();
  const target = config.delivery.targets.find(t => t.name === targetName);
  if (!target) {
    throw new Error(`Unknown delivery target: ${targetName}`);
  }

  let adapter: DeliveryAdapter;
  if (target.type === 'openclaw') {
    adapter = new OpenClawAdapter({
      name: target.name,
      gateway_url: target.gateway_url,
      hooks_token: target.hooks_token,
      hooks_path: target.hooks_path,
      channel: target.channel,
    });
  } else {
    adapter = new DiscordAdapter({
      name: target.name,
      webhook_url: target.webhook_url,
    });
  }

  adapterCache.set(targetName, adapter);
  return adapter;
}

export function createDeliverProcessor() {
  return async (job: Job<DeliverJobData>): Promise<void> => {
    const { target_name, payload } = job.data;

    // Rehydrate dates from JSON serialization
    if (payload.bundle) {
      payload.bundle.created_at = new Date(payload.bundle.created_at);
      payload.bundle.events = payload.bundle.events.map(e => ({
        ...e,
        published_at: new Date(e.published_at),
        ingested_at: new Date(e.ingested_at),
        scored_at: new Date(e.scored_at),
      }));
    }

    log.info({ targetName: target_name, bundleId: payload.bundle.bundle_id }, 'Delivering to target');

    const adapter = getAdapter(target_name);
    await adapter.deliver(payload, job.attemptsMade + 1);

    log.info({ targetName: target_name, bundleId: payload.bundle.bundle_id }, 'Delivery complete');
  };
}
