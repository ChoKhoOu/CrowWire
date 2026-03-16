import { DEFAULTS } from '../../config/constants.js';
import { TransientError, PermanentError, FatalError } from '../../types/errors.js';
import { eventsDeliveredTotal, deliveryDuration } from '../../shared/metrics.js';
import { checkIdempotency, markDelivered } from './audit-log.js';
import type { FlushPayload, DeliveryResult } from '../../types/delivery.js';
import type { DeliveryAdapter } from './types.js';

const DISCORD_MAX_LENGTH = 2000;

interface DiscordTargetConfig {
  name: string;
  webhook_url: string;
}

export class DiscordAdapter implements DeliveryAdapter {
  private config: DiscordTargetConfig;

  constructor(config: DiscordTargetConfig) {
    this.config = config;
  }

  async deliver(payload: FlushPayload): Promise<DeliveryResult> {
    const { bundle, message } = payload;
    const startTime = Date.now();
    const targetName = this.config.name;

    const skip = await checkIdempotency(bundle.idempotency_key, targetName, bundle.bundle_id);
    if (skip) return skip;

    let content = message;
    if (content.length > DISCORD_MAX_LENGTH) {
      content = content.substring(0, 1990) + '\n... [truncated]';
    }

    try {
      const response = await fetch(this.config.webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
        signal: AbortSignal.timeout(DEFAULTS.DELIVERY_TIMEOUT_MS),
      });

      const duration = Date.now() - startTime;
      const success = response.status >= 200 && response.status < 300;

      const result: DeliveryResult = {
        success,
        status_code: response.status,
        target_name: targetName,
        attempted_at: new Date(),
        duration_ms: duration,
      };

      deliveryDuration.observe(duration / 1000);
      eventsDeliveredTotal.inc({ bundle_type: bundle.bundle_type, success: String(result.success) });

      if (success) {
        await markDelivered(bundle.idempotency_key, targetName);
      }

      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        throw new TransientError(`Discord rate limited (429)${retryAfter ? `, retry after ${retryAfter}s` : ''}`);
      }
      if (response.status === 401 || response.status === 403) {
        throw new FatalError(`Discord auth failed (${response.status}): invalid webhook`);
      }
      if (response.status >= 500) {
        throw new TransientError(`Discord server error (${response.status})`);
      }
      if (response.status === 400) {
        throw new PermanentError(`Discord rejected request (${response.status})`);
      }

      return result;

    } catch (error) {
      if (error instanceof FatalError || error instanceof PermanentError || error instanceof TransientError) {
        throw error;
      }
      throw new TransientError(`Discord delivery failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
