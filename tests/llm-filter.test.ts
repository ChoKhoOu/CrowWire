import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { scoreBatch, _resetLlmClient } from '../src/lib/llm.js';
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

describe('scoreBatch with blacklist', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    _resetLlmClient();
    process.env.LLM_BASE_URL = 'https://fake-llm.test/v1';
    process.env.LLM_API_KEY = 'test-key';
    process.env.LLM_MODEL = 'test-model';
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    _resetLlmClient();
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_MODEL;
  });

  it('without blacklist returns items without blacklisted field', async () => {
    const items = [makeFeedItem()];
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify([
          { id: 'test-1', urgency: 80, relevance: 70, novelty: 60, summary: '测试摘要' },
        ]) } }],
      }),
    });

    const result = await scoreBatch(items);
    expect(result[0].urgency).toBe(80);
    expect(result[0].blacklisted).toBeUndefined();
    expect(result[0].blacklist_reason).toBeUndefined();
  });

  it('with blacklist includes blacklist categories in prompt', async () => {
    const items = [makeFeedItem()];
    const blacklist = ['大A个股涨跌相关新闻'];

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify([
          { id: 'test-1', urgency: 80, relevance: 70, novelty: 60, summary: '测试', blacklisted: false },
        ]) } }],
      }),
    });

    await scoreBatch(items, blacklist);

    const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    const systemPrompt = callBody.messages[0].content;
    expect(systemPrompt).toContain('blacklist categories');
    expect(systemPrompt).toContain('大A个股涨跌相关新闻');
  });

  it('correctly merges blacklisted=true items', async () => {
    const items = [
      makeFeedItem({ id: 'a', title: '个股涨停' }),
      makeFeedItem({ id: 'b', title: 'Fed Rate Decision' }),
    ];
    const blacklist = ['大A个股涨跌'];

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify([
          { id: 'a', urgency: 50, relevance: 50, novelty: 50, summary: '个股', blacklisted: true, blacklist_reason: '大A个股涨跌' },
          { id: 'b', urgency: 90, relevance: 85, novelty: 70, summary: 'Fed', blacklisted: false },
        ]) } }],
      }),
    });

    const result = await scoreBatch(items, blacklist);
    expect(result[0].blacklisted).toBe(true);
    expect(result[0].blacklist_reason).toBe('大A个股涨跌');
    expect(result[1].blacklisted).toBeUndefined();
    expect(result[1].blacklist_reason).toBeUndefined();
  });

  it('degraded mode sets blacklisted=undefined (pass-through)', async () => {
    const items = [makeFeedItem()];
    const blacklist = ['大A个股'];

    fetchMock.mockRejectedValueOnce(new Error('LLM timeout'));

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const result = await scoreBatch(items, blacklist);
    stderrSpy.mockRestore();

    expect(result[0].urgency).toBe(50); // default
    expect(result[0].blacklisted).toBeUndefined();
  });

  it('scoring fields are correctly extracted when blacklist is also present (prompt regression)', async () => {
    const items = [makeFeedItem({ id: 'reg-1' })];
    const blacklist = ['某个分类'];

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify([
          { id: 'reg-1', urgency: 95, relevance: 88, novelty: 72, summary: '回归测试摘要', blacklisted: false },
        ]) } }],
      }),
    });

    const result = await scoreBatch(items, blacklist);
    expect(result[0].urgency).toBe(95);
    expect(result[0].relevance).toBe(88);
    expect(result[0].novelty).toBe(72);
    expect(result[0].summary).toBe('回归测试摘要');
    expect(result[0].blacklisted).toBeUndefined(); // false maps to undefined
  });

  it('mergeScores sets blacklisted=undefined when LLM returns non-boolean', async () => {
    const items = [makeFeedItem({ id: 'nb-1' })];
    const blacklist = ['某分类'];

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify([
          { id: 'nb-1', urgency: 60, relevance: 60, novelty: 60, summary: '测试', blacklisted: 'yes', blacklist_reason: 123 },
        ]) } }],
      }),
    });

    const result = await scoreBatch(items, blacklist);
    expect(result[0].blacklisted).toBeUndefined(); // 'yes' !== true
    expect(result[0].blacklist_reason).toBeUndefined(); // 123 is not a string
  });
});
