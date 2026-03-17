import { describe, it, expect } from 'vitest';
import { formatUrgent, formatDigest, formatDigestGrouped, splitMarkdownMessages } from '../src/lib/formatter.js';
import type { ScoredItem, EventGroup } from '../src/types.js';

function makeScored(id: string, source: string, urgency: number, relevance: number, opts?: { summary?: string; content?: string }): ScoredItem {
  return {
    id,
    title: `Title ${id}`,
    link: `https://example.com/${id}`,
    content: opts?.content ?? `Content for ${id} with details`,
    published_at: new Date().toISOString(),
    source,
    content_hash: `ch-${id}`,
    urgency,
    relevance,
    novelty: 50,
    summary: opts?.summary,
  };
}

describe('formatUrgent', () => {
  it('formats as "- summary <link>" per item', () => {
    const items = [makeScored('a', 'Reuters', 95, 80, { summary: '美联储宣布降息25个基点' })];
    const result = formatUrgent(items);
    expect(result).toContain('🚨');
    expect(result).toContain('紧急快讯');
    expect(result).toContain('- 美联储宣布降息25个基点 <https://example.com/a>');
  });

  it('strips title prefix from content when no summary', () => {
    const items = [makeScored('a', 'Reuters', 95, 80, {
      content: '【Title a】财联社3月17日电，重要消息内容',
    })];
    const result = formatUrgent(items);
    expect(result).toContain('财联社3月17日电，重要消息内容');
    expect(result).not.toContain('【Title a】');
  });

  it('returns empty string for no items', () => {
    expect(formatUrgent([])).toBe('');
  });
});

describe('formatDigest', () => {
  it('formats high-relevance items as "- summary <link>"', () => {
    const items = [
      makeScored('fed', 'Bloomberg', 50, 90, { summary: '美联储加息预期升温' }),
      makeScored('ecb', 'Reuters', 50, 85, { summary: '欧央行维持利率不变' }),
    ];
    const result = formatDigest(items);
    expect(result).toContain('🔥 重点关注');
    expect(result).toContain('- 美联储加息预期升温 _(Bloomberg)_ <https://example.com/fed>');
    expect(result).toContain('- 欧央行维持利率不变 _(Reuters)_ <https://example.com/ecb>');
  });

  it('formats low-relevance items as "- summary <link>"', () => {
    const items = [
      makeScored('a', 'Reuters', 30, 50, { summary: '摘要A' }),
      makeScored('b', 'Bloomberg', 20, 40, { summary: '摘要B' }),
    ];
    const result = formatDigest(items);
    expect(result).toContain('📋 其他资讯（2条）');
    expect(result).toContain('- 摘要A _(Reuters)_ <https://example.com/a>');
    expect(result).toContain('- 摘要B _(Bloomberg)_ <https://example.com/b>');
  });

  it('shows both sections when mixed relevance', () => {
    const items = [
      makeScored('important', 'Reuters', 50, 85),
      makeScored('minor', 'Bloomberg', 40, 40),
    ];
    const result = formatDigest(items);
    expect(result).toContain('🔥 重点关注');
    expect(result).toContain('📋 其他资讯（1条）');
  });

  it('includes header with item count', () => {
    const items = [makeScored('a', 'Source', 50, 80)];
    const result = formatDigest(items);
    expect(result).toContain('📰');
    expect(result).toContain('新闻摘要');
    expect(result).toContain('共 1 条');
  });

  it('falls back to cleaned content when no summary', () => {
    const items = [makeScored('a', 'Source', 50, 80, {
      content: '【Title a】这是真正的新闻内容',
    })];
    const result = formatDigest(items);
    expect(result).toContain('这是真正的新闻内容');
    expect(result).not.toContain('【Title a】');
  });

  it('falls back to title when content equals title', () => {
    const items = [makeScored('a', 'Source', 50, 80, { content: 'Title a' })];
    const result = formatDigest(items);
    expect(result).toContain('- Title a _(Source)_ <https://example.com/a>');
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

  it('renders multi-source group with merged summary and multiple links', () => {
    const group = makeGroup(
      [makeScored('a', 'Bloomberg', 50, 80), makeScored('b', 'Reuters', 50, 75)],
      '美联储宣布加息，多家机构确认。',
    );
    const result = formatDigestGrouped([group]);
    expect(result).toContain('- 美联储宣布加息，多家机构确认。 _(Bloomberg、Reuters)_ <https://example.com/a> <https://example.com/b>');
  });

  it('falls back to joined snippets when mergedSummary is undefined', () => {
    const group = makeGroup(
      [
        makeScored('a', 'Bloomberg', 50, 80, { summary: '摘要A' }),
        makeScored('b', 'Reuters', 50, 75, { summary: '摘要B' }),
      ],
    );
    const result = formatDigestGrouped([group]);
    expect(result).toContain('摘要A');
    expect(result).toContain('摘要B');
  });

  it('renders single-item group as "- summary <link>"', () => {
    const group = makeGroup([makeScored('a', 'Source', 50, 80, { summary: '单条摘要' })]);
    const result = formatDigestGrouped([group]);
    expect(result).toContain('- 单条摘要 _(Source)_ <https://example.com/a>');
  });

  it('splits high and low relevance groups', () => {
    const high = makeGroup([makeScored('hi', 'Bloomberg', 50, 90)]);
    const low = makeGroup([makeScored('lo', 'Reuters', 30, 40)]);
    const result = formatDigestGrouped([high, low]);
    expect(result).toContain('🔥 重点关注');
    expect(result).toContain('📋 其他资讯（1条）');
  });

  it('wraps all URLs in <> to suppress Discord embeds', () => {
    const group = makeGroup([makeScored('a', 'Source', 50, 80)]);
    const result = formatDigestGrouped([group]);
    expect(result).toContain('<https://example.com/a>');
  });

  it('returns empty string for no groups', () => {
    expect(formatDigestGrouped([])).toBe('');
  });
});

describe('splitMarkdownMessages', () => {
  it('returns single message when under limit', () => {
    expect(splitMarkdownMessages('Short message', 100)).toEqual(['Short message']);
  });

  it('returns empty array for empty input', () => {
    expect(splitMarkdownMessages('', 100)).toEqual([]);
  });

  it('splits at paragraph boundaries', () => {
    const text = 'Block A content here\n\nBlock B content here\n\nBlock C content here';
    const result = splitMarkdownMessages(text, 40);
    expect(result.length).toBeGreaterThan(1);
    for (const msg of result) {
      expect(msg.length).toBeLessThanOrEqual(40);
    }
    expect(result.join('\n\n')).toContain('Block A');
    expect(result.join('\n\n')).toContain('Block B');
    expect(result.join('\n\n')).toContain('Block C');
  });

  it('falls back to line-level splitting for long paragraphs', () => {
    const longParagraph = Array(10).fill('这是一行较长的中文内容用于测试').join('\n');
    const result = splitMarkdownMessages(longParagraph, 100);
    expect(result.length).toBeGreaterThan(1);
    for (const msg of result) {
      expect(msg.length).toBeLessThanOrEqual(100);
    }
  });

  it('keeps a real digest under Discord limit per chunk', () => {
    const items = Array.from({ length: 20 }, (_, i) => makeScored(`item${i}`, `Source${i % 5}`, 50, 60 + i));
    const text = formatDigest(items);
    const messages = splitMarkdownMessages(text, 1900);
    for (const msg of messages) {
      expect(msg.length).toBeLessThanOrEqual(1900);
    }
    expect(messages[0]).toContain('📰');
  });
});
