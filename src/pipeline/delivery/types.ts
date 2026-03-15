import type { FlushPayload, DeliveryResult } from '../../types/delivery.js';

export interface DeliveryAdapter {
  deliver(payload: FlushPayload, attemptNumber: number): Promise<DeliveryResult>;
}
