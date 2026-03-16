import { DEFAULTS } from '../../config/constants.js';
import { TransientError, PermanentError, FatalError } from '../../types/errors.js';
import { eventsDeliveredTotal, deliveryDuration } from '../../shared/metrics.js';
import { checkIdempotency, markDelivered } from './audit-log.js';
import type { FlushPayload, DeliveryResult } from '../../types/delivery.js';
import type { DeliveryAdapter } from './types.js';

interface OpenClawTargetConfig {
  name: string;
  gateway_url: string;
  hooks_token: string;
  hooks_path: string;
  channel: string;
}

export class OpenClawAdapter implements DeliveryAdapter {
  private config: OpenClawTargetConfig;

  constructor(config: OpenClawTargetConfig) {
    this.config = config;
  }

  async deliver(payload: FlushPayload): Promise<DeliveryResult> {
    const { bundle, message } = payload;
    const startTime = Date.now();
    const targetName = this.config.name;

    const skip = await checkIdempotency(bundle.idempotency_key, targetName, bundle.bundle_id);
    if (skip) return skip;

    const url = `${this.config.gateway_url}${this.config.hooks_path}/agent`;
    const body = {
      message,
      name: 'CrowWire',
      agentId: 'main',
      wakeMode: 'now',
      deliver: true,
      channel: this.config.channel,
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.hooks_token}`,
          'Idempotency-Key': bundle.idempotency_key,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(DEFAULTS.DELIVERY_TIMEOUT_MS),
      });

      const duration = Date.now() - startTime;
      const success = response.status === 200 || response.status === 202;

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

      if (response.status === 401) {
        throw new FatalError(`OpenClaw auth failed (401): invalid token`);
      }
      if (response.status === 429) {
        throw new TransientError(`OpenClaw rate limited (429)`);
      }
      if (response.status >= 500) {
        throw new TransientError(`OpenClaw server error (${response.status})`);
      }
      if (response.status === 400 || response.status === 413) {
        throw new PermanentError(`OpenClaw rejected request (${response.status})`);
      }

      return result;

    } catch (error) {
      if (error instanceof FatalError || error instanceof PermanentError || error instanceof TransientError) {
        throw error;
      }
      throw new TransientError(`OpenClaw delivery failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
