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

export interface DeliveryPayload {
  message: string;
  name: 'CrowWire';
  agentId: 'main';
  wakeMode: 'now';
  deliver: true;
  channel: string;
  _bundle: EventBundle;     // Internal tracking (not sent to OpenClaw)
}

export interface DeliveryResult {
  success: boolean;
  status_code: number;
  response_body?: unknown;
  error?: string;
  attempted_at: Date;
  duration_ms: number;
}
