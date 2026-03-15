import { uuidv7 } from 'uuidv7';
import { getDb } from '../../db/client.js';
import { deliveryLog } from '../../db/schema.js';
import { getEnv } from '../../config/env.js';
import { hasSuccessfulDelivery } from './audit-log.js';
import { DEFAULTS } from '../../config/constants.js';
import { createChildLogger } from '../../shared/logger.js';
import { TransientError, PermanentError, FatalError } from '../../types/errors.js';
import { eventsDeliveredTotal, deliveryDuration } from '../../shared/metrics.js';
import type { DeliveryPayload, DeliveryResult } from '../../types/delivery.js';

const log = createChildLogger({ module: 'openclaw-bridge' });

export class OpenClawBridge {
  async deliver(payload: DeliveryPayload, attemptNumber: number = 1): Promise<DeliveryResult> {
    const env = getEnv();
    const bundle = payload._bundle;
    const startTime = Date.now();

    // Check for idempotent skip
    if (await hasSuccessfulDelivery(bundle.idempotency_key)) {
      log.info({ bundleId: bundle.bundle_id, idempotencyKey: bundle.idempotency_key }, 'Idempotent skip: already delivered');
      const result: DeliveryResult = {
        success: true,
        status_code: 200,
        attempted_at: new Date(),
        duration_ms: Date.now() - startTime,
      };
      // Record idempotent skip in audit log
      await this.writeAuditLog(bundle.bundle_id, bundle.bundle_type, bundle.event_count, attemptNumber, 200, true, 'idempotent_skip', result.duration_ms, bundle.idempotency_key);
      return result;
    }

    // Build request
    const url = `${env.OPENCLAW_GATEWAY_URL}${env.OPENCLAW_HOOKS_PATH}/agent`;
    const body = {
      message: payload.message,
      name: payload.name,
      agentId: payload.agentId,
      wakeMode: payload.wakeMode,
      deliver: payload.deliver,
      channel: payload.channel,
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.OPENCLAW_HOOKS_TOKEN}`,
          'Idempotency-Key': bundle.idempotency_key,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(DEFAULTS.DELIVERY_TIMEOUT_MS),
      });

      const duration = Date.now() - startTime;
      const responseText = await response.text();
      let responseBody: unknown;
      try {
        responseBody = JSON.parse(responseText);
      } catch {
        responseBody = responseText;
      }

      const result: DeliveryResult = {
        success: response.status === 202 || response.status === 200,
        status_code: response.status,
        response_body: responseBody,
        attempted_at: new Date(),
        duration_ms: duration,
      };

      deliveryDuration.observe(duration / 1000);
      eventsDeliveredTotal.inc({ bundle_type: bundle.bundle_type, success: String(result.success) });

      // Write audit log
      await this.writeAuditLog(bundle.bundle_id, bundle.bundle_type, bundle.event_count, attemptNumber, response.status, result.success, result.success ? undefined : `HTTP ${response.status}`, duration, bundle.idempotency_key);

      // Classify errors
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
      const duration = Date.now() - startTime;

      if (error instanceof FatalError || error instanceof PermanentError || error instanceof TransientError) {
        await this.writeAuditLog(bundle.bundle_id, bundle.bundle_type, bundle.event_count, attemptNumber, (error instanceof FatalError ? 401 : 0), false, error.message, duration, bundle.idempotency_key);
        throw error;
      }

      // Timeout or network error
      await this.writeAuditLog(bundle.bundle_id, bundle.bundle_type, bundle.event_count, attemptNumber, 0, false, error instanceof Error ? error.message : String(error), duration, bundle.idempotency_key);
      throw new TransientError(`OpenClaw delivery failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async writeAuditLog(
    bundleId: string, bundleType: string, eventCount: number,
    attemptNumber: number, statusCode: number, success: boolean,
    errorMessage: string | undefined, durationMs: number, idempotencyKey: string,
  ): Promise<void> {
    try {
      const db = getDb();
      await db.insert(deliveryLog).values({
        id: uuidv7(),
        bundle_id: bundleId,
        bundle_type: bundleType,
        event_count: eventCount,
        attempt_number: attemptNumber,
        status_code: statusCode,
        success,
        error_message: errorMessage || null,
        duration_ms: durationMs,
        idempotency_key: idempotencyKey,
        attempted_at: new Date(),
      });
    } catch (err) {
      log.error({ err, bundleId }, 'Failed to write audit log');
    }
  }
}
