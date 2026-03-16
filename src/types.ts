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
