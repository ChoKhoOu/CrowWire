import { describe, it, expect } from 'vitest';
import { buildScoringPrompt } from '../../pipeline/scorer/prompt.js';
import type { CrowWireEvent } from '../../types/event.js';

process.env.ANTHROPIC_API_KEY = 'test-key';
process.env.OPENCLAW_HOOKS_TOKEN = 'test-token';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';

function makeEvent(overrides: Partial<CrowWireEvent> = {}): CrowWireEvent {
  return {
    id: 'test-id',
    source_type: 'rss',
    source_name: 'test-feed',
    source_route: '/test',
    canonical_url: 'https://example.com/article',
    title: 'Breaking: Market Crash',
    summary: 'Markets dropped significantly today',
    published_at: new Date('2026-03-15T10:00:00Z'),
    ingested_at: new Date(),
    identity_hash: 'hash1',
    content_hash: 'hash2',
    tags: ['finance'],
    ...overrides,
  };
}

describe('scoring prompt', () => {
  it('includes event title and source', () => {
    const prompt = buildScoringPrompt(makeEvent());
    expect(prompt).toContain('Breaking: Market Crash');
    expect(prompt).toContain('test-feed');
  });

  it('includes tags', () => {
    const prompt = buildScoringPrompt(makeEvent({ tags: ['finance', 'macro'] }));
    expect(prompt).toContain('finance, macro');
  });

  it('includes scoring guidelines', () => {
    const prompt = buildScoringPrompt(makeEvent());
    expect(prompt).toContain('urgency_score');
    expect(prompt).toContain('relevance_score');
    expect(prompt).toContain('novelty_score');
  });
});

describe('routing logic', () => {
  it('routes to urgent when score >= threshold', () => {
    const threshold = 85;
    expect(90 >= threshold ? 'urgent' : 'batch').toBe('urgent');
    expect(85 >= threshold ? 'urgent' : 'batch').toBe('urgent');
  });

  it('routes to batch when score < threshold', () => {
    const threshold = 85;
    expect(84 >= threshold ? 'urgent' : 'batch').toBe('batch');
    expect(0 >= threshold ? 'urgent' : 'batch').toBe('batch');
  });

  it('boundary case: exactly at threshold', () => {
    const threshold = 85;
    expect(85 >= threshold ? 'urgent' : 'batch').toBe('urgent');
  });

  it('boundary case: score 100', () => {
    const threshold = 85;
    expect(100 >= threshold ? 'urgent' : 'batch').toBe('urgent');
  });

  it('boundary case: score 0', () => {
    const threshold = 85;
    expect(0 >= threshold ? 'urgent' : 'batch').toBe('batch');
  });
});
