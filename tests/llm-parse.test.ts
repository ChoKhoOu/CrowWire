import { describe, it, expect } from 'vitest';
import { extractLlmPayload } from '../src/lib/llm.js';

const SCORED_ARRAY = [
  { id: 'a', urgency: 88, relevance: 77, novelty: 66, summary: '测试摘要' },
];

describe('extractLlmPayload', () => {
  it('returns a direct array as-is', () => {
    expect(extractLlmPayload(SCORED_ARRAY)).toEqual(SCORED_ARRAY);
  });

  it('unwraps { output: [...] }', () => {
    expect(extractLlmPayload({ output: SCORED_ARRAY })).toEqual(SCORED_ARRAY);
  });

  it('unwraps { result: [...] }', () => {
    expect(extractLlmPayload({ result: SCORED_ARRAY })).toEqual(SCORED_ARRAY);
  });

  it('unwraps HTTP envelope with details.json (array)', () => {
    const envelope = {
      ok: true,
      result: {
        content: [{ type: 'text', text: JSON.stringify(SCORED_ARRAY) }],
        details: {
          json: SCORED_ARRAY,
          provider: 'packycode',
          model: 'gpt-5.4',
        },
      },
    };
    expect(extractLlmPayload(envelope)).toEqual(SCORED_ARRAY);
  });

  it('unwraps HTTP envelope with details.json (string)', () => {
    const envelope = {
      ok: true,
      result: {
        content: [{ type: 'text', text: '总结文本' }],
        details: {
          json: '总结文本',
          provider: 'packycode',
          model: 'gpt-5.4',
        },
      },
    };
    expect(extractLlmPayload(envelope)).toBe('总结文本');
  });

  it('falls back to content[0].text JSON when details.json is absent', () => {
    const envelope = {
      ok: true,
      result: {
        content: [{ type: 'text', text: JSON.stringify(SCORED_ARRAY) }],
        details: { provider: 'packycode', model: 'gpt-5.4' },
      },
    };
    expect(extractLlmPayload(envelope)).toEqual(SCORED_ARRAY);
  });

  it('falls back to content[0].text raw string when not valid JSON', () => {
    const envelope = {
      ok: true,
      result: {
        content: [{ type: 'text', text: '这是一段总结文本' }],
        details: { provider: 'packycode' },
      },
    };
    expect(extractLlmPayload(envelope)).toBe('这是一段总结文本');
  });

  it('returns direct string as-is', () => {
    expect(extractLlmPayload('hello')).toBe('hello');
  });

  it('returns null/undefined as-is', () => {
    expect(extractLlmPayload(null)).toBeNull();
    expect(extractLlmPayload(undefined)).toBeUndefined();
  });

  it('prefers details.json over content[0].text', () => {
    const envelope = {
      ok: true,
      result: {
        content: [{ type: 'text', text: 'stale' }],
        details: { json: 'fresh' },
      },
    };
    expect(extractLlmPayload(envelope)).toBe('fresh');
  });

  it('prefers HTTP envelope over legacy { result }', () => {
    // When ok=true and result is an object with details, it should NOT fall through to legacy
    const envelope = {
      ok: true,
      result: {
        details: { json: SCORED_ARRAY },
        content: [],
      },
    };
    expect(extractLlmPayload(envelope)).toEqual(SCORED_ARRAY);
  });
});
