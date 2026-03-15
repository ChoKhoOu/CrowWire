import { eq, and } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { getDb } from '../../db/client.js';
import { deliveryLog } from '../../db/schema.js';
import { createChildLogger } from '../../shared/logger.js';
import type { DeliveryResult } from '../../types/delivery.js';

const log = createChildLogger({ module: 'audit-log' });

export async function hasSuccessfulDelivery(idempotencyKey: string, targetName: string): Promise<boolean> {
  const db = getDb();
  const result = await db.select({ id: deliveryLog.id })
    .from(deliveryLog)
    .where(
      and(
        eq(deliveryLog.idempotency_key, idempotencyKey),
        eq(deliveryLog.target_name, targetName),
        eq(deliveryLog.success, true)
      )
    )
    .limit(1);
  return result.length > 0;
}

export async function writeAuditLog(
  bundleId: string, bundleType: string, eventCount: number,
  attemptNumber: number, statusCode: number, success: boolean,
  errorMessage: string | undefined, durationMs: number,
  idempotencyKey: string, targetName: string,
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
      target_name: targetName,
      attempted_at: new Date(),
    });
  } catch (err) {
    log.error({ err, bundleId, targetName }, 'Failed to write audit log');
  }
}

export async function checkIdempotency(
  idempotencyKey: string, targetName: string, bundleId: string, attemptNumber: number,
): Promise<DeliveryResult | null> {
  if (await hasSuccessfulDelivery(idempotencyKey, targetName)) {
    log.info({ bundleId, idempotencyKey, targetName }, 'Idempotent skip: already delivered');
    await writeAuditLog(bundleId, '', 0, attemptNumber, 200, true, 'idempotent_skip', 0, idempotencyKey, targetName);
    return {
      success: true,
      status_code: 200,
      target_name: targetName,
      attempted_at: new Date(),
      duration_ms: 0,
    };
  }
  return null;
}
