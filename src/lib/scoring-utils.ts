// Shared scoring utilities — extracted to break circular dependency between llm.ts and xml-parser.ts

export const DEFAULT_SCORES = { urgency: 50, relevance: 50, novelty: 50 };

/** Validate and coerce a value to integer in [0, 100]. Accepts number or parseable string. */
export function safeInt(val: unknown, fallback: number): number {
  if (typeof val === 'number' && Number.isInteger(val) && val >= 0 && val <= 100) {
    return val;
  }
  if (typeof val === 'string') {
    const parsed = parseInt(val, 10);
    if (!isNaN(parsed) && parsed >= 0 && parsed <= 100) {
      return parsed;
    }
  }
  return fallback;
}
