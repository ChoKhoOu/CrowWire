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
    const res = await fetch(`${server.address}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 512,
        messages: [{ role: 'user', content: `Title: ${title}\nSummary: test` }],
        tools: [],
        tool_choice: { type: 'function', function: { name: 'score_event' } },
      }),
    });
    const data = await res.json() as any;
    return JSON.parse(data.choices[0].message.tool_calls[0].function.arguments);
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

  it('returns valid OpenAI tool_calls format', async () => {
    const res = await fetch(`${server.address}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'test',
        max_tokens: 512,
        messages: [{ role: 'user', content: 'Title: Test\nSummary: test' }],
      }),
    });
    const data = await res.json() as any;
    const toolCall = data.choices[0].message.tool_calls[0];
    expect(toolCall.type).toBe('function');
    expect(toolCall.function.name).toBe('score_event');
    const args = JSON.parse(toolCall.function.arguments);
    expect(args.urgency_score).toBeTypeOf('number');
    expect(args.category_tags).toBeInstanceOf(Array);
    expect(args.reason).toBeTypeOf('string');
  });
});
