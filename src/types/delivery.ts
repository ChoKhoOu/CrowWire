import type { ScoredEvent } from './event.js';

export interface EventBundle {
  bundle_id: string;           // UUIDv7 -- for tracking/logging only
  idempotency_key: string;     // SHA256(sorted(event_ids)) -- content-derived
  bundle_type: 'urgent' | 'batch';
  created_at: Date;
  event_count: number;
  events: ScoredEvent[];
  tags: string[];              // Union of all event tags
}

export interface FlushPayload {
  bundle: EventBundle;
  message: string;
}

export interface DeliverJobData {
  target_name: string;
  target_type: 'discord' | 'openclaw';
  payload: FlushPayload;
}

export interface DeliveryResult {
  success: boolean;
  status_code: number;
  target_name: string;
  response_body?: unknown;
  error?: string;
  attempted_at: Date;
  duration_ms: number;
}
