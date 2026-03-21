export interface FeedSource {
  name: string;
  url: string;
  enabled: boolean;
}

export interface FeedsConfig {
  feeds: FeedSource[];
  settings: {
    urgent_threshold: number;
    digest_interval_minutes: number;
    dedup_ttl_hours: number;
    content_max_chars: number;
    max_items_per_run: number;
    similarity_threshold?: number;
    sent_event_ttl_hours?: number;
  };
}

export interface FeedItem {
  id: string;
  title: string;
  link: string;
  content: string;
  published_at: string;
  source: string;
  content_hash: string;
}

export interface ScoredItem extends FeedItem {
  urgency: number;
  relevance: number;
  novelty: number;
  summary?: string;
}

export interface EventGroup {
  representative: ScoredItem;
  members: ScoredItem[];
  mergedSummary?: string;
  isMultiSource: boolean;
}

export interface ClassifyOutput {
  urgent: ScoredItem[];
  digest: ScoredItem[];
  digestGroups?: EventGroup[];
  has_urgent: boolean;
  has_digest: boolean;
  has_output: boolean;
  stats: {
    new_items: number;
    buffered: number;
    digest_flushed: number;
  };
}

// ---- CrowWire v2 Daemon Types ----

export type QueueType = 'urgent' | 'normal'

export type PushTargetType = 'discord'  // extensible: | 'telegram' | 'slack'

export interface PushTargetConfig {
  name: string
  type: PushTargetType
  channel_id: string
  queues: QueueType[]
}

export interface TargetsConfig {
  targets: PushTargetConfig[]
}

export interface DaemonConfig {
  fetch_interval: number        // ms, default 20000
  urgent_flush_interval: number // ms, default 10000
  urgent_flush_count: number    // default 5
  digest_flush_interval: number // ms, default 900000
  urgency_threshold: number     // 0-100, default 75
  similarity_threshold: number  // 0-1, default 0.55
  dedup_ttl_hours: number       // default 72
  sent_event_ttl_hours: number  // default 24
  content_max_chars: number     // default 500
  max_items_per_run: number     // default 30
  db_path: string
  feeds_config: string
  targets_config: string
}
