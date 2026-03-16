import { describe, it, expect, vi } from 'vitest';

vi.mock('../../config/config.js', () => {
  const cfg = {
    server: { port: 3000, node_env: 'test', log_level: 'error' },
    redis: { url: 'redis://localhost:6379' },
    llm: { provider: 'openai', api_key: 'test-key', base_url: 'http://localhost:9999/v1', scoring_model: 'test-model', summarization_model: 'test-model' },
    feeds: { rsshub_base_url: 'http://localhost:1200', sources: [] },
    delivery: { targets: [] },
    scoring: { urgent_threshold: 85, batch_summarization_threshold: 20 },
    queue: { ingest_concurrency: 1, scorer_concurrency: 1, deliver_concurrency: 1, urgent_flush_interval_ms: 30000, batch_flush_interval_ms: 600000, batch_flush_count_threshold: 50 },
    dedup: { ttl_hours: 72, title_bucket_minutes: 30 },
    content: { max_size_bytes: 102400 },
  };
  return {
    loadConfig: vi.fn(() => cfg),
    getConfig: vi.fn(() => cfg),
  };
});

import { normalize } from '../../pipeline/normalizer/normalizer.js';
import type { FeedConfig } from '../../types/feed.js';

const mockFeed: FeedConfig = {
  name: 'test-feed',
  source_type: 'rss',
  url: 'https://example.com/feed',
  poll_interval_ms: 60000,
  enabled: true,
  tags: ['test'],
};

describe('normalizer', () => {
  it('normalizes a valid RSS item', () => {
    const result = normalize({
      title: 'Test Article',
      link: 'https://example.com/article?utm_source=rss',
      guid: 'guid-123',
      pubDate: '2026-03-15T10:00:00Z',
      isoDate: '2026-03-15T10:00:00.000Z',
      content: 'Full content here',
      contentSnippet: 'Content snippet',
    }, mockFeed);

    expect(result).not.toBeNull();
    expect(result!.title).toBe('Test Article');
    expect(result!.canonical_url).not.toContain('utm_source');
    expect(result!.source_name).toBe('test-feed');
    expect(result!.identity_hash).toBeTruthy();
    expect(result!.content_hash).toBeTruthy();
    expect(result!.tags).toEqual(['test']);
  });

  it('returns null for missing title', () => {
    const result = normalize({ link: 'https://example.com' }, mockFeed);
    expect(result).toBeNull();
  });

  it('returns null for missing link', () => {
    const result = normalize({ title: 'Test' }, mockFeed);
    expect(result).toBeNull();
  });

  it('truncates oversized content', () => {
    const bigContent = 'x'.repeat(200000);
    const result = normalize({
      title: 'Big Article',
      link: 'https://example.com/big',
      content: bigContent,
    }, mockFeed);

    expect(result).not.toBeNull();
    expect(Buffer.byteLength(result!.content || '', 'utf-8')).toBeLessThanOrEqual(102400);
  });

  it('uses contentSnippet as summary fallback', () => {
    const result = normalize({
      title: 'Test',
      link: 'https://example.com/test',
      contentSnippet: 'My snippet',
    }, mockFeed);

    expect(result!.summary).toBe('My snippet');
  });

  it('uses title as summary when no snippet', () => {
    const result = normalize({
      title: 'Test Title',
      link: 'https://example.com/test2',
    }, mockFeed);

    expect(result!.summary).toBe('Test Title');
  });
});
