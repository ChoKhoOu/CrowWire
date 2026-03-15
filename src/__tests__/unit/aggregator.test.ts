import { describe, it, expect } from 'vitest';
import { formatStructuredText } from '../../pipeline/aggregator/aggregator.js';
import type { ScoredEvent } from '../../types/event.js';

function makeScoredEvent(overrides: Partial<ScoredEvent> = {}): ScoredEvent {
  return {
    id: 'test-id',
    source_type: 'rss',
    source_name: 'test-feed',
    source_route: '/test',
    canonical_url: 'https://example.com/article',
    title: 'Test Article',
    summary: 'Test summary',
    published_at: new Date('2026-03-15T10:00:00Z'),
    ingested_at: new Date(),
    identity_hash: 'hash1',
    content_hash: 'hash2',
    tags: ['test'],
    urgency_score: 75,
    relevance_score: 80,
    novelty_score: 60,
    category_tags: ['finance'],
    score_reason: 'Test reason',
    routing: 'batch',
    scored_at: new Date(),
    ...overrides,
  };
}

describe('formatStructuredText', () => {
  it('formats a single event correctly', () => {
    const events = [makeScoredEvent({ urgency_score: 90, title: 'Breaking News', category_tags: ['finance', 'macro'] })];
    const result = formatStructuredText(events);
    expect(result).toBe('[90] Breaking News — test-feed (finance, macro)');
  });

  it('formats multiple events with newlines', () => {
    const events = [
      makeScoredEvent({ urgency_score: 90, title: 'Event A', category_tags: ['finance'] }),
      makeScoredEvent({ urgency_score: 70, title: 'Event B', category_tags: ['tech'] }),
    ];
    const result = formatStructuredText(events);
    const lines = result.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('[90]');
    expect(lines[1]).toContain('[70]');
  });

  it('handles empty events array', () => {
    const result = formatStructuredText([]);
    expect(result).toBe('');
  });
});
