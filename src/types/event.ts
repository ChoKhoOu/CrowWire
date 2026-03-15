export interface RawFeedItem {
  title?: string;
  link?: string;
  guid?: string;
  pubDate?: string;
  content?: string;
  contentSnippet?: string;
  isoDate?: string;
}

export interface CrowWireEvent {
  id: string;                    // UUIDv7
  source_type: 'rss' | 'rsshub';
  source_name: string;
  source_route: string;
  guid?: string;
  canonical_url: string;
  title: string;
  summary: string;
  content?: string;
  published_at: Date;
  ingested_at: Date;
  identity_hash: string;
  content_hash: string;
  tags: string[];
}

export interface ScoredEvent extends CrowWireEvent {
  urgency_score: number;        // 0-100
  relevance_score: number;      // 0-100
  novelty_score: number;        // 0-100
  category_tags: string[];
  score_reason: string;
  routing: 'urgent' | 'batch';
  scored_at: Date;
}
