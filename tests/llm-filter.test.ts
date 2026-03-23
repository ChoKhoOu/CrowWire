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

/** Create a mock SSE streaming response from XML content (Responses API format) */
function makeStreamResponse(xmlContent: string) {
  const sseData =
    `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: xmlContent })}\n\n` +
    `data: ${JSON.stringify({ type: 'response.completed' })}\n\n`;

  return {
    ok: true,
    status: 200,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sseData));
        controller.close();
      },
    }),
  };
}

describe('scoreBatch with blacklist (XML streaming)', () => {
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
    fetchMock.mockResolvedValueOnce(makeStreamResponse(
      '<news_list><news><id>test-1</id><scores><urgency>80</urgency><relevance>70</relevance><novelty>60</novelty></scores><summary>测试摘要</summary></news></news_list>'
    ));

    const result = await scoreBatch(items);
    expect(result[0].urgency).toBe(80);
    expect(result[0].blacklisted).toBeUndefined();
    expect(result[0].blacklist_reason).toBeUndefined();
  });

  it('with blacklist includes blacklist categories in prompt', async () => {
    const items = [makeFeedItem()];
    const blacklist = ['大A个股涨跌相关新闻'];

    fetchMock.mockResolvedValueOnce(makeStreamResponse(
      '<news_list><news><id>test-1</id><scores><urgency>80</urgency><relevance>70</relevance><novelty>60</novelty></scores><summary>测试</summary><blacklist><hit>false</hit><reason></reason></blacklist></news></news_list>'
    ));

    await scoreBatch(items, blacklist);

    const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    const systemPrompt = callBody.instructions;
    expect(systemPrompt).toContain('blacklist categories');
    expect(systemPrompt).toContain('大A个股涨跌相关新闻');
  });

  it('correctly merges blacklisted=true items', async () => {
    const items = [
      makeFeedItem({ id: 'a', title: '个股涨停' }),
      makeFeedItem({ id: 'b', title: 'Fed Rate Decision' }),
    ];
    const blacklist = ['大A个股涨跌'];

    fetchMock.mockResolvedValueOnce(makeStreamResponse(
      '<news_list>' +
      '<news><id>a</id><scores><urgency>50</urgency><relevance>50</relevance><novelty>50</novelty></scores><summary>个股</summary><blacklist><hit>true</hit><reason>大A个股涨跌</reason></blacklist></news>' +
      '<news><id>b</id><scores><urgency>90</urgency><relevance>85</relevance><novelty>70</novelty></scores><summary>Fed</summary><blacklist><hit>false</hit><reason></reason></blacklist></news>' +
      '</news_list>'
    ));

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

    fetchMock.mockResolvedValueOnce(makeStreamResponse(
      '<news_list><news><id>reg-1</id><scores><urgency>95</urgency><relevance>88</relevance><novelty>72</novelty></scores><summary>回归测试摘要</summary><blacklist><hit>false</hit><reason></reason></blacklist></news></news_list>'
    ));

    const result = await scoreBatch(items, blacklist);
    expect(result[0].urgency).toBe(95);
    expect(result[0].relevance).toBe(88);
    expect(result[0].novelty).toBe(72);
    expect(result[0].summary).toBe('回归测试摘要');
    expect(result[0].blacklisted).toBeUndefined(); // false maps to undefined
  });

  it('mergeXmlScores sets blacklisted=undefined when XML returns non-true hit', async () => {
    const items = [makeFeedItem({ id: 'nb-1' })];
    const blacklist = ['某分类'];

    fetchMock.mockResolvedValueOnce(makeStreamResponse(
      '<news_list><news><id>nb-1</id><scores><urgency>60</urgency><relevance>60</relevance><novelty>60</novelty></scores><summary>测试</summary><blacklist><hit>yes</hit><reason>123</reason></blacklist></news></news_list>'
    ));

    const result = await scoreBatch(items, blacklist);
    expect(result[0].blacklisted).toBeUndefined(); // 'yes' !== 'true'
    expect(result[0].blacklist_reason).toBeUndefined(); // not blacklisted, so no reason
  });
});
