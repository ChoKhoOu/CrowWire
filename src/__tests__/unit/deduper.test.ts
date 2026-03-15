import { describe, it, expect, vi } from 'vitest';

vi.mock('../../config/config.js', () => {
  const cfg = {
    server: { port: 3000, node_env: 'test', log_level: 'error' },
    database: { url: 'postgresql://test:test@localhost:5432/test' },
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

import { computeIdentityHash } from '../../pipeline/deduper/identity-hash.js';
import { computeContentHash } from '../../pipeline/deduper/content-hash.js';
import { computeTitleFingerprint } from '../../pipeline/deduper/title-fingerprint.js';
import type { CrowWireEvent } from '../../types/event.js';

function makeEvent(overrides: Partial<CrowWireEvent> = {}): CrowWireEvent {
  return {
    id: 'test-id',
    source_type: 'rss',
    source_name: 'test-feed',
    source_route: '/test',
    canonical_url: 'https://example.com/article',
    title: 'Test Article Title',
    summary: 'Test summary',
    published_at: new Date('2026-03-15T10:00:00Z'),
    ingested_at: new Date(),
    identity_hash: '',
    content_hash: '',
    tags: ['test'],
    ...overrides,
  };
}

describe('identity-hash', () => {
  it('uses guid when available', () => {
    const e1 = makeEvent({ guid: 'guid-1' });
    const e2 = makeEvent({ guid: 'guid-1', canonical_url: 'https://other.com' });
    expect(computeIdentityHash(e1)).toBe(computeIdentityHash(e2));
  });

  it('falls back to canonical_url', () => {
    const e1 = makeEvent({ guid: undefined, canonical_url: 'https://example.com/a' });
    const e2 = makeEvent({ guid: undefined, canonical_url: 'https://example.com/a' });
    expect(computeIdentityHash(e1)).toBe(computeIdentityHash(e2));
  });

  it('different guids produce different hashes', () => {
    const e1 = makeEvent({ guid: 'guid-1' });
    const e2 = makeEvent({ guid: 'guid-2' });
    expect(computeIdentityHash(e1)).not.toBe(computeIdentityHash(e2));
  });
});

describe('content-hash', () => {
  it('same content same hash', () => {
    const e1 = makeEvent({ title: 'A', summary: 'B', content: 'C' });
    const e2 = makeEvent({ title: 'A', summary: 'B', content: 'C' });
    expect(computeContentHash(e1)).toBe(computeContentHash(e2));
  });

  it('different content different hash', () => {
    const e1 = makeEvent({ title: 'A', summary: 'B', content: 'C' });
    const e2 = makeEvent({ title: 'A', summary: 'B', content: 'D' });
    expect(computeContentHash(e1)).not.toBe(computeContentHash(e2));
  });
});

describe('title-fingerprint', () => {
  it('removes stopwords and sorts', () => {
    const e1 = makeEvent({ title: 'The Quick Brown Fox' });
    const e2 = makeEvent({ title: 'Quick Brown Fox The' });
    expect(computeTitleFingerprint(e1)).toBe(computeTitleFingerprint(e2));
  });

  it('is case insensitive', () => {
    const e1 = makeEvent({ title: 'Breaking News Today' });
    const e2 = makeEvent({ title: 'breaking news today' });
    expect(computeTitleFingerprint(e1)).toBe(computeTitleFingerprint(e2));
  });

  it('different sources produce different fingerprints', () => {
    const e1 = makeEvent({ title: 'Same Title', source_name: 'feed-a' });
    const e2 = makeEvent({ title: 'Same Title', source_name: 'feed-b' });
    expect(computeTitleFingerprint(e1)).not.toBe(computeTitleFingerprint(e2));
  });

  it('different time buckets produce different fingerprints', () => {
    const e1 = makeEvent({ title: 'Same Title', published_at: new Date('2026-03-15T10:00:00Z') });
    const e2 = makeEvent({ title: 'Same Title', published_at: new Date('2026-03-15T11:00:00Z') });
    expect(computeTitleFingerprint(e1)).not.toBe(computeTitleFingerprint(e2));
  });
});
