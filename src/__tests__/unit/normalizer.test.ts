import { describe, it, expect } from 'vitest';
import { normalize } from '../../pipeline/normalizer/normalizer.js';
import type { FeedConfig } from '../../types/feed.js';

// Must set env vars before importing modules that use getEnv
process.env.ANTHROPIC_API_KEY = 'test-key';
process.env.OPENCLAW_HOOKS_TOKEN = 'test-token';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';

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
