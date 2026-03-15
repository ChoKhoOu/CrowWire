export interface FeedConfig {
  name: string;
  source_type: 'rss' | 'rsshub';
  route?: string;              // for rsshub
  url?: string;                // for direct rss
  poll_interval_ms: number;
  enabled: boolean;
  tags: string[];
}
