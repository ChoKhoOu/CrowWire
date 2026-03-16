import { getRedisConnection } from '../../queue/connection.js';
import { createChildLogger } from '../../shared/logger.js';
import type { DeliveryResult } from '../../types/delivery.js';

const log = createChildLogger({ module: 'idempotency' });

const IDEMPOTENCY_TTL_SECONDS = 86400 * 7; // 7 days

function redisKey(idempotencyKey: string, targetName: string): string {
  return `delivery:idempotent:${idempotencyKey}:${targetName}`;
}

export async function checkIdempotency(
  idempotencyKey: string, targetName: string, bundleId: string,
): Promise<DeliveryResult | null> {
  const redis = getRedisConnection();
  const exists = await redis.get(redisKey(idempotencyKey, targetName));
  if (exists) {
    log.info({ bundleId, idempotencyKey, targetName }, 'Idempotent skip: already delivered');
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

export async function markDelivered(idempotencyKey: string, targetName: string): Promise<void> {
  const redis = getRedisConnection();
  await redis.set(redisKey(idempotencyKey, targetName), '1', 'EX', IDEMPOTENCY_TTL_SECONDS);
}
