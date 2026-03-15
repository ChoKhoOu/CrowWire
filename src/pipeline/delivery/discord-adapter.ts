import { DEFAULTS } from '../../config/constants.js';
import { TransientError, PermanentError, FatalError } from '../../types/errors.js';
import { eventsDeliveredTotal, deliveryDuration } from '../../shared/metrics.js';
import { checkIdempotency, writeAuditLog } from './audit-log.js';
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

  async deliver(payload: FlushPayload, attemptNumber: number): Promise<DeliveryResult> {
    const { bundle, message } = payload;
    const startTime = Date.now();
    const targetName = this.config.name;

    // Check for idempotent skip
    const skip = await checkIdempotency(bundle.idempotency_key, targetName, bundle.bundle_id, attemptNumber);
    if (skip) return skip;

    // Truncate message for Discord's 2000 char limit
    let content = message;
    if (content.length > DISCORD_MAX_LENGTH) {
      content = content.substring(0, 1990) + '\n... [truncated]';
    }

    try {
      const response = await fetch(this.config.webhook_url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content }),
        signal: AbortSignal.timeout(DEFAULTS.DELIVERY_TIMEOUT_MS),
      });

      const duration = Date.now() - startTime;
      let responseBody: unknown;
      try {
        const responseText = await response.text();
        responseBody = JSON.parse(responseText);
      } catch {
        responseBody = undefined;
      }

      // Discord returns 204 on success for webhooks
      const success = response.status >= 200 && response.status < 300;

      const result: DeliveryResult = {
        success,
        status_code: response.status,
        target_name: targetName,
        response_body: responseBody,
        attempted_at: new Date(),
        duration_ms: duration,
      };

      deliveryDuration.observe(duration / 1000);
      eventsDeliveredTotal.inc({ bundle_type: bundle.bundle_type, success: String(result.success) });

      await writeAuditLog(bundle.bundle_id, bundle.bundle_type, bundle.event_count, attemptNumber, response.status, success, success ? undefined : `HTTP ${response.status}`, duration, bundle.idempotency_key, targetName);

      // Classify errors
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
      const duration = Date.now() - startTime;

      if (error instanceof FatalError || error instanceof PermanentError || error instanceof TransientError) {
        await writeAuditLog(bundle.bundle_id, bundle.bundle_type, bundle.event_count, attemptNumber, 0, false, error.message, duration, bundle.idempotency_key, targetName);
        throw error;
      }

      // Timeout or network error
      await writeAuditLog(bundle.bundle_id, bundle.bundle_type, bundle.event_count, attemptNumber, 0, false, error instanceof Error ? error.message : String(error), duration, bundle.idempotency_key, targetName);
      throw new TransientError(`Discord delivery failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
