import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createMockModelServer } from '../fixtures/mock-model-server.js';

let server: Awaited<ReturnType<typeof createMockModelServer>>;

beforeAll(async () => {
  server = await createMockModelServer();
});

afterAll(async () => {
  await server.close();
});

describe('mock-model-server', () => {
  async function score(title: string) {
    const res = await fetch(`${server.address}/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20250315',
        max_tokens: 512,
        messages: [{ role: 'user', content: `Title: ${title}\nSummary: test` }],
        tools: [],
        tool_choice: { type: 'tool', name: 'score_event' },
      }),
    });
    const data = await res.json() as any;
    return data.content[0].input;
  }

  it('scores "breaking" as urgent (90)', async () => {
    const result = await score('Breaking: Market Crash');
    expect(result.urgency_score).toBe(90);
  });

  it('scores "quarterly" as batch (50)', async () => {
    const result = await score('Quarterly Earnings Report');
    expect(result.urgency_score).toBe(50);
  });

  it('scores generic as moderate (70)', async () => {
    const result = await score('New Policy Announced');
    expect(result.urgency_score).toBe(70);
  });

  it('scores AI/tech topics appropriately (65)', async () => {
    const result = await score('New AI Model Released');
    expect(result.urgency_score).toBe(65);
  });

  it('returns valid tool_use format', async () => {
    const res = await fetch(`${server.address}/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'test',
        max_tokens: 512,
        messages: [{ role: 'user', content: 'Title: Test\nSummary: test' }],
      }),
    });
    const data = await res.json() as any;
    expect(data.content[0].type).toBe('tool_use');
    expect(data.content[0].name).toBe('score_event');
    expect(data.content[0].input.urgency_score).toBeTypeOf('number');
    expect(data.content[0].input.category_tags).toBeInstanceOf(Array);
    expect(data.content[0].input.reason).toBeTypeOf('string');
  });
});
