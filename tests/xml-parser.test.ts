import { describe, it, expect } from 'vitest';
import { createNewsXmlParser, mergeXmlScores, type ParsedNewsItem } from '../src/lib/xml-parser.js';
import { safeInt } from '../src/lib/llm.js';
import type { FeedItem } from '../src/types.js';

function makeFeedItem(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    id: 'test-1',
    title: 'Test News',
    link: 'https://example.com/1',
    content: 'Some content',
    published_at: '2026-03-23T00:00:00Z',
    source: 'test-source',
    content_hash: 'abc123',
    ...overrides,
  };
}

describe('createNewsXmlParser', () => {
  it('parses a complete valid XML block', () => {
    const items: ParsedNewsItem[] = [];
    const parser = createNewsXmlParser(item => items.push(item));
    parser.write(`<news_list>
      <news>
        <id>item-1</id>
        <scores>
          <urgency>90</urgency>
          <relevance>85</relevance>
          <novelty>70</novelty>
        </scores>
        <summary>据多方消息确认</summary>
      </news>
    </news_list>`);
    parser.end();

    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('item-1');
    expect(items[0].urgency).toBe(90);
    expect(items[0].relevance).toBe(85);
    expect(items[0].novelty).toBe(70);
    expect(items[0].summary).toBe('据多方消息确认');
  });

  it('converts score text to numbers via parseInt', () => {
    const items: any[] = [];
    const parser = createNewsXmlParser(item => items.push(item));
    parser.write('<news_list><news><id>n1</id><scores><urgency>90</urgency><relevance>85</relevance><novelty>70</novelty></scores><summary>test</summary></news></news_list>');
    parser.end();

    expect(typeof items[0].urgency).toBe('number');
    expect(items[0].urgency).toBe(90);
  });

  it('handles invalid score text as undefined', () => {
    const items: any[] = [];
    const parser = createNewsXmlParser(item => items.push(item));
    parser.write('<news_list><news><id>n1</id><scores><urgency>invalid</urgency><relevance>85</relevance><novelty>abc</novelty></scores><summary>test</summary></news></news_list>');
    parser.end();

    expect(items[0].urgency).toBeUndefined();
    expect(items[0].relevance).toBe(85);
    expect(items[0].novelty).toBeUndefined();
  });

  it('silently ignores unknown tags', () => {
    const items: any[] = [];
    const parser = createNewsXmlParser(item => items.push(item));
    parser.write('<news_list><news><id>n1</id><extra>foo</extra><scores><urgency>80</urgency><relevance>70</relevance><novelty>60</novelty></scores><summary>test</summary><custom_field>bar</custom_field></news></news_list>');
    parser.end();

    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('n1');
    expect(items[0].urgency).toBe(80);
    expect((items[0] as any).extra).toBeUndefined();
  });

  it('handles <hit>true</hit> as blacklisted: true', () => {
    const items: any[] = [];
    const parser = createNewsXmlParser(item => items.push(item));
    parser.write('<news_list><news><id>n1</id><scores><urgency>50</urgency><relevance>50</relevance><novelty>50</novelty></scores><summary>test</summary><blacklist><hit>true</hit><reason>大A个股</reason></blacklist></news></news_list>');
    parser.end();

    expect(items[0].blacklisted).toBe(true);
    expect(items[0].blacklist_reason).toBe('大A个股');
  });

  it('handles <hit>false</hit> as blacklisted: false', () => {
    const items: any[] = [];
    const parser = createNewsXmlParser(item => items.push(item));
    parser.write('<news_list><news><id>n1</id><scores><urgency>50</urgency><relevance>50</relevance><novelty>50</novelty></scores><summary>test</summary><blacklist><hit>false</hit><reason></reason></blacklist></news></news_list>');
    parser.end();

    expect(items[0].blacklisted).toBe(false);
  });

  it('handles <hit>TRUE</hit> case-insensitively', () => {
    const items: any[] = [];
    const parser = createNewsXmlParser(item => items.push(item));
    parser.write('<news_list><news><id>n1</id><scores><urgency>50</urgency><relevance>50</relevance><novelty>50</novelty></scores><summary>t</summary><blacklist><hit>TRUE</hit><reason>test</reason></blacklist></news></news_list>');
    parser.end();

    expect(items[0].blacklisted).toBe(true);
  });

  it('rejects <hit>yes</hit> — only "true" accepted', () => {
    const items: any[] = [];
    const parser = createNewsXmlParser(item => items.push(item));
    parser.write('<news_list><news><id>n1</id><scores><urgency>50</urgency><relevance>50</relevance><novelty>50</novelty></scores><summary>t</summary><blacklist><hit>yes</hit><reason>test</reason></blacklist></news></news_list>');
    parser.end();

    expect(items[0].blacklisted).toBe(false);
  });

  it('rejects <hit>1</hit> — only "true" accepted', () => {
    const items: any[] = [];
    const parser = createNewsXmlParser(item => items.push(item));
    parser.write('<news_list><news><id>n1</id><scores><urgency>50</urgency><relevance>50</relevance><novelty>50</novelty></scores><summary>t</summary><blacklist><hit>1</hit><reason>test</reason></blacklist></news></news_list>');
    parser.end();

    expect(items[0].blacklisted).toBe(false);
  });

  it('parses multiple <news> blocks', () => {
    const items: any[] = [];
    const parser = createNewsXmlParser(item => items.push(item));
    parser.write('<news_list><news><id>a</id><scores><urgency>90</urgency><relevance>80</relevance><novelty>70</novelty></scores><summary>first</summary></news><news><id>b</id><scores><urgency>40</urgency><relevance>50</relevance><novelty>60</novelty></scores><summary>second</summary></news></news_list>');
    parser.end();

    expect(items).toHaveLength(2);
    expect(items[0].id).toBe('a');
    expect(items[0].urgency).toBe(90);
    expect(items[1].id).toBe('b');
    expect(items[1].urgency).toBe(40);
  });

  it('handles streaming — small chunks produce same result', () => {
    const items: any[] = [];
    const parser = createNewsXmlParser(item => items.push(item));
    const xml = '<news_list><news><id>s1</id><scores><urgency>75</urgency><relevance>65</relevance><novelty>55</novelty></scores><summary>流式测试</summary></news></news_list>';

    // Write char by char to simulate streaming
    for (const char of xml) {
      parser.write(char);
    }
    parser.end();

    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('s1');
    expect(items[0].urgency).toBe(75);
    expect(items[0].summary).toBe('流式测试');
  });

  it('handles incomplete XML — no crash, partial item emitted with available data', () => {
    const items: any[] = [];
    const parser = createNewsXmlParser(item => items.push(item));
    // Stream cuts off mid-tag — htmlparser2 auto-closes on end()
    parser.write('<news_list><news><id>cut</id><scores><urgency>80</urgency><relevance>');
    parser.end();

    // htmlparser2 flushes partial items on end() — this is fine,
    // mergeXmlScores will fill in defaults for missing fields
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('cut');
    expect(items[0].urgency).toBe(80);
    expect(items[0].relevance).toBeUndefined(); // was mid-tag
  });

  it('handles missing summary as undefined', () => {
    const items: any[] = [];
    const parser = createNewsXmlParser(item => items.push(item));
    parser.write('<news_list><news><id>n1</id><scores><urgency>50</urgency><relevance>50</relevance><novelty>50</novelty></scores></news></news_list>');
    parser.end();

    expect(items[0].summary).toBeUndefined();
  });
});

describe('mergeXmlScores', () => {
  it('maps parsed items to originals by id', () => {
    const originals = [
      makeFeedItem({ id: 'a' }),
      makeFeedItem({ id: 'b' }),
    ];
    const parsed = [
      { id: 'a', urgency: 90, relevance: 85, novelty: 70, summary: '摘要A' },
      { id: 'b', urgency: 40, relevance: 50, novelty: 60, summary: '摘要B' },
    ];
    const result = mergeXmlScores(originals, parsed);

    expect(result[0].urgency).toBe(90);
    expect(result[0].summary).toBe('摘要A');
    expect(result[1].urgency).toBe(40);
    expect(result[1].summary).toBe('摘要B');
  });

  it('uses defaults when id not found in parsed', () => {
    const originals = [makeFeedItem({ id: 'missing' })];
    const parsed = [{ id: 'other', urgency: 90, relevance: 85, novelty: 70 }];
    const result = mergeXmlScores(originals, parsed);

    expect(result[0].urgency).toBe(50);
    expect(result[0].relevance).toBe(50);
    expect(result[0].novelty).toBe(50);
    expect(result[0].summary).toBeUndefined();
  });

  it('silently ignores extra ids not in originals', () => {
    const originals = [makeFeedItem({ id: 'a' })];
    const parsed = [
      { id: 'a', urgency: 80, relevance: 70, novelty: 60, summary: 'ok' },
      { id: 'extra', urgency: 90, relevance: 90, novelty: 90, summary: 'ignored' },
    ];
    const result = mergeXmlScores(originals, parsed);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a');
  });

  it('maps blacklisted: false to undefined (preserves ScoredItem API contract)', () => {
    const originals = [makeFeedItem({ id: 'a' })];
    const parsed = [{ id: 'a', urgency: 50, relevance: 50, novelty: 50, blacklisted: false }];
    const result = mergeXmlScores(originals, parsed);

    expect(result[0].blacklisted).toBeUndefined();
    expect(result[0].blacklist_reason).toBeUndefined();
  });

  it('maps blacklisted: true with reason', () => {
    const originals = [makeFeedItem({ id: 'a' })];
    const parsed = [{ id: 'a', urgency: 50, relevance: 50, novelty: 50, blacklisted: true, blacklist_reason: '大A个股涨跌' }];
    const result = mergeXmlScores(originals, parsed);

    expect(result[0].blacklisted).toBe(true);
    expect(result[0].blacklist_reason).toBe('大A个股涨跌');
  });
});

describe('safeInt', () => {
  it('accepts number input', () => {
    expect(safeInt(90, 50)).toBe(90);
  });

  it('accepts string input "90"', () => {
    expect(safeInt('90', 50)).toBe(90);
  });

  it('rejects out-of-range number', () => {
    expect(safeInt(150, 50)).toBe(50);
    expect(safeInt(-5, 50)).toBe(50);
  });

  it('rejects out-of-range string', () => {
    expect(safeInt('150', 50)).toBe(50);
    expect(safeInt('-5', 50)).toBe(50);
  });

  it('rejects non-numeric string', () => {
    expect(safeInt('abc', 50)).toBe(50);
  });

  it('rejects non-integer number', () => {
    expect(safeInt(90.5, 50)).toBe(50);
  });

  it('returns fallback for undefined/null', () => {
    expect(safeInt(undefined, 50)).toBe(50);
    expect(safeInt(null, 50)).toBe(50);
  });
});
