// Streaming XML parser for LLM scoring output
// Uses htmlparser2 SAX parser with strict tag whitelist

import { Parser } from 'htmlparser2';
import type { FeedItem, ScoredItem } from '../types.js';
import { safeInt, DEFAULT_SCORES } from './scoring-utils.js';

// Strict tag whitelist — unknown tags are silently ignored
const KNOWN_TAGS = new Set([
  'news_list', 'news', 'id', 'scores', 'urgency', 'relevance', 'novelty',
  'summary', 'blacklist', 'hit', 'reason',
]);

export interface ParsedNewsItem {
  id?: string;
  urgency?: number;
  relevance?: number;
  novelty?: number;
  summary?: string;
  blacklisted?: boolean;
  blacklist_reason?: string;
}

const MAX_TEXT_BUFFER = 10_000; // 10KB per text node — prevents memory exhaustion

/**
 * Create a streaming XML parser for LLM scoring output.
 * Emits a ParsedNewsItem each time a </news> tag closes.
 * Unknown tags are silently ignored.
 */
export function createNewsXmlParser(onItem: (item: ParsedNewsItem) => void): {
  write: (chunk: string) => void;
  end: () => void;
} {
  const tagStack: string[] = [];
  let currentItem: ParsedNewsItem = {};
  let textBuffer = '';

  const parser = new Parser({
    onopentag(name) {
      const lower = name.toLowerCase();
      if (!KNOWN_TAGS.has(lower)) return;
      tagStack.push(lower);
      textBuffer = '';
      if (lower === 'news') {
        currentItem = {};
      }
    },

    ontext(text) {
      if (tagStack.length > 0 && textBuffer.length < MAX_TEXT_BUFFER) {
        textBuffer += text.slice(0, MAX_TEXT_BUFFER - textBuffer.length);
      }
    },

    onclosetag(name) {
      const lower = name.toLowerCase();
      if (tagStack.length === 0 || tagStack[tagStack.length - 1] !== lower) return;
      tagStack.pop();

      const trimmed = textBuffer.trim();

      switch (lower) {
        case 'id':
          currentItem.id = trimmed || undefined;
          break;
        case 'urgency': {
          const val = parseInt(trimmed, 10);
          currentItem.urgency = isNaN(val) ? undefined : val;
          break;
        }
        case 'relevance': {
          const val = parseInt(trimmed, 10);
          currentItem.relevance = isNaN(val) ? undefined : val;
          break;
        }
        case 'novelty': {
          const val = parseInt(trimmed, 10);
          currentItem.novelty = isNaN(val) ? undefined : val;
          break;
        }
        case 'summary':
          currentItem.summary = trimmed || undefined;
          break;
        case 'hit':
          currentItem.blacklisted = trimmed.toLowerCase() === 'true';
          break;
        case 'reason':
          currentItem.blacklist_reason = trimmed;
          break;
        case 'news':
          onItem({ ...currentItem });
          currentItem = {};
          break;
      }

      // Reset text buffer when leaving a leaf tag
      textBuffer = '';
    },
  }, { xmlMode: true, decodeEntities: true });

  return {
    write(chunk: string) {
      parser.write(chunk);
    },
    end() {
      parser.end();
    },
  };
}

/**
 * Merge parsed XML items with original FeedItems to produce ScoredItems.
 * Preserves existing ScoredItem API contract:
 * - Scores validated via safeInt (accepts number or parseable string)
 * - blacklisted: true → true, false/missing → undefined (NOT false)
 * - blacklist_reason: only set when blacklisted === true
 */
export function mergeXmlScores(originals: FeedItem[], parsed: ParsedNewsItem[]): ScoredItem[] {
  const scoreMap = new Map<string, ParsedNewsItem>();
  for (const p of parsed) {
    if (p.id) {
      scoreMap.set(p.id, p);
    }
  }

  return originals.map(item => {
    const p = scoreMap.get(item.id);
    return {
      ...item,
      urgency: safeInt(p?.urgency, DEFAULT_SCORES.urgency),
      relevance: safeInt(p?.relevance, DEFAULT_SCORES.relevance),
      novelty: safeInt(p?.novelty, DEFAULT_SCORES.novelty),
      summary: typeof p?.summary === 'string' && p.summary.trim() ? p.summary.trim() : undefined,
      blacklisted: p?.blacklisted === true ? true : undefined,
      blacklist_reason: p?.blacklisted === true && typeof p?.blacklist_reason === 'string' && p.blacklist_reason
        ? p.blacklist_reason
        : undefined,
    };
  });
}
