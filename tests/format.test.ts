import { describe, it, expect } from 'vitest';
import { formatUrgent, formatDigest, formatDigestGrouped } from '../src/lib/formatter.js';
import type { ScoredItem, EventGroup } from '../src/types.js';

function makeScored(id: string, source: string, urgency: number, relevance: number): ScoredItem {
  return {
    id,
    title: `Title ${id}`,
    link: `https://example.com/${id}`,
    content: `Content ${id}`,
    published_at: new Date().toISOString(),
    source,
    content_hash: `ch-${id}`,
    urgency,
    relevance,
    novelty: 50,
  };
}

describe('formatUrgent', () => {
  it('formats breaking news with Chinese header, title, source, score, link', () => {
    const items = [makeScored('a', 'Reuters', 95, 80)];
    const result = formatUrgent(items);
    expect(result).toContain('🚨');
    expect(result).toContain('紧急快讯');
    expect(result).toContain('Title a');
    expect(result).toContain('Reuters');
    expect(result).toContain('95/100');
    expect(result).toContain('https://example.com/a');
  });

  it('formats multiple urgent items', () => {
    const items = [
      makeScored('a', 'Reuters', 95, 80),
      makeScored('b', 'Bloomberg', 90, 70),
    ];
    const result = formatUrgent(items);
    expect(result).toContain('Title a');
    expect(result).toContain('Title b');
  });

  it('returns empty string for no items', () => {
    expect(formatUrgent([])).toBe('');
  });
});

describe('formatDigest', () => {
  it('aggregates high-relevance items into one briefing block', () => {
    const items = [
      makeScored('fed', 'Bloomberg', 50, 90),
      makeScored('ecb', 'Reuters', 50, 85),
    ];
    const result = formatDigest(items);
    expect(result).toContain('🔥 今日要闻');
    // Both titles should appear in the same paragraph (joined by ；)
    const briefingLine = result.split('\n').find(l => l.includes('Title fed') && l.includes('Title ecb'));
    expect(briefingLine).toBeDefined();
    // Links collected at bottom
    expect(result).toContain('相关链接');
    expect(result).toContain('[Title fed](https://example.com/fed)');
    expect(result).toContain('[Title ecb](https://example.com/ecb)');
  });

  it('shows low-relevance items each with their own summary', () => {
    const items = [
      makeScored('a', 'Reuters', 30, 50),
      makeScored('b', 'Bloomberg', 20, 40),
    ];
    const result = formatDigest(items);
    expect(result).toContain('📋 其他资讯（2条）');
    // Each item has its own title block
    expect(result).toContain('**Title a**');
    expect(result).toContain('**Title b**');
    expect(result).toContain('Content a');
    expect(result).toContain('Content b');
    expect(result).toContain('[原文](https://example.com/a)');
    expect(result).toContain('[原文](https://example.com/b)');
  });

  it('shows both sections when mixed relevance', () => {
    const items = [
      makeScored('important', 'Reuters', 50, 85),
      makeScored('minor', 'Bloomberg', 40, 40),
    ];
    const result = formatDigest(items);
    expect(result).toContain('🔥 今日要闻');
    expect(result).toContain('📋 其他资讯（1条）');
  });

  it('shows only briefing when all items are high relevance', () => {
    const items = [
      makeScored('a', 'Reuters', 50, 80),
      makeScored('b', 'Bloomberg', 60, 75),
    ];
    const result = formatDigest(items);
    expect(result).toContain('🔥 今日要闻');
    expect(result).not.toContain('📋 其他资讯');
  });

  it('includes header with item count', () => {
    const items = [makeScored('a', 'Source', 50, 80)];
    const result = formatDigest(items);
    expect(result).toContain('📰');
    expect(result).toContain('新闻摘要');
    expect(result).toContain('1 条资讯');
  });

  it('returns empty string for no items', () => {
    expect(formatDigest([])).toBe('');
  });
});

describe('formatDigestGrouped', () => {
  function makeGroup(items: ScoredItem[], mergedSummary?: string): EventGroup {
    const representative = items.reduce((best, i) => i.relevance > best.relevance ? i : best);
    const sources = new Set(items.map(i => i.source));
    return { representative, members: items, isMultiSource: sources.size >= 2, mergedSummary };
  }

  it('renders multi-source group with merged summary', () => {
    const group = makeGroup(
      [makeScored('a', 'Bloomberg', 50, 80), makeScored('b', 'Reuters', 50, 75)],
      '美联储宣布加息，多家机构确认。',
    );
    const result = formatDigestGrouped([group]);
    expect(result).toContain('美联储宣布加息，多家机构确认。');
    expect(result).toContain('综合 Bloomberg、Reuters 报道');
    expect(result).toContain('[Title a](https://example.com/a)');
    expect(result).toContain('[Title b](https://example.com/b)');
  });

  it('falls back to bullet-point titles when mergedSummary is undefined', () => {
    const group = makeGroup(
      [makeScored('a', 'Bloomberg', 50, 80), makeScored('b', 'Reuters', 50, 75)],
    );
    const result = formatDigestGrouped([group]);
    expect(result).toContain('- Title a（Bloomberg）');
    expect(result).toContain('- Title b（Reuters）');
  });

  it('renders single-item groups like formatDigest', () => {
    const group = makeGroup([makeScored('a', 'Source', 50, 80)]);
    const result = formatDigestGrouped([group]);
    expect(result).toContain('**Title a**');
    expect(result).toContain('Source');
  });

  it('splits high and low relevance groups', () => {
    const high = makeGroup([makeScored('hi', 'Bloomberg', 50, 90)]);
    const low = makeGroup([makeScored('lo', 'Reuters', 30, 40)]);
    const result = formatDigestGrouped([high, low]);
    expect(result).toContain('🔥 今日要闻');
    expect(result).toContain('📋 其他资讯（1条）');
  });

  it('returns empty string for no groups', () => {
    expect(formatDigestGrouped([])).toBe('');
  });
});
