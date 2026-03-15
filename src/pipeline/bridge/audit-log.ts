import { eq, and } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import { deliveryLog } from '../../db/schema.js';

export async function hasSuccessfulDelivery(idempotencyKey: string): Promise<boolean> {
  const db = getDb();
  const result = await db.select({ id: deliveryLog.id })
    .from(deliveryLog)
    .where(
      and(
        eq(deliveryLog.idempotency_key, idempotencyKey),
        eq(deliveryLog.success, true)
      )
    )
    .limit(1);
  return result.length > 0;
}
