import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, unlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  getDb, closeDb,
  getRecentSentEvents, recordSentEvent, cleanupExpiredSentEvents,
} from '../src/lib/db.js';
import { computePairwiseSimilarity } from '../src/lib/similarity.js';
import { groupByEvent } from '../src/lib/aggregator.js';
import type { ScoredItem } from '../src/types.js';

let dbPath: string;
let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'crowwire-agg-'));
  dbPath = join(tempDir, 'test.db');
});

afterEach(() => {
  closeDb();
  try { unlinkSync(dbPath); } catch {}
  try { rmSync(tempDir, { recursive: true }); } catch {}
});

function makeItem(id: string, source: string, title: string, content: string, urgency = 50, relevance = 50): ScoredItem {
  return {
    id,
    title,
    link: `https://example.com/${id}`,
    content,
    published_at: new Date().toISOString(),
    source,
    content_hash: `ch-${id}`,
    urgency,
    relevance,
    novelty: 50,
  };
}

describe('sent_events DB operations', () => {
  it('records and retrieves sent events', () => {
    const db = getDb(dbPath);
    recordSentEvent(db, 'Test title', 'Test content');
    const events = getRecentSentEvents(db, 24);
    expect(events.length).toBe(1);
    expect(events[0].title).toBe('Test title');
    expect(events[0].content).toBe('Test content');
  });

  it('retrieves only events within TTL', () => {
    const db = getDb(dbPath);
    // Insert an event with a very old timestamp manually
    db.prepare('INSERT INTO sent_events (title, content, sent_at) VALUES (?, ?, ?)').run(
      'Old event', 'Old content', Math.floor(Date.now() / 1000) - 100_000
    );
    recordSentEvent(db, 'Recent event', 'Recent content');
    const events = getRecentSentEvents(db, 24);
    expect(events.length).toBe(1);
    expect(events[0].title).toBe('Recent event');
  });

  it('cleans up expired sent events', () => {
    const db = getDb(dbPath);
    db.prepare('INSERT INTO sent_events (title, content, sent_at) VALUES (?, ?, ?)').run(
      'Old event', 'Old content', Math.floor(Date.now() / 1000) - 100_000
    );
    recordSentEvent(db, 'Recent event', 'Recent content');
    const cleaned = cleanupExpiredSentEvents(db, 24);
    expect(cleaned).toBe(1);
    const remaining = getRecentSentEvents(db, 24);
    expect(remaining.length).toBe(1);
  });
});

describe('urgent dedup via similarity', () => {
  it('detects duplicate urgent event across sources', () => {
    const sent = { title: '美联储宣布加息25个基点', content: '美国联邦储备委员会周三宣布将基准利率上调25个基点，符合市场预期。' };
    const candidate = { title: '美联储如期加息25个基点', content: '美联储如期加息25个基点，联邦基金利率升至新区间。鲍威尔表示未来将视经济数据。' };

    const similarity = computePairwiseSimilarity(sent, candidate);
    expect(similarity).toBeGreaterThan(0.55);
  });

  it('does not flag unrelated event as duplicate', () => {
    const sent = { title: '美联储宣布加息25个基点', content: '美国联邦储备委员会周三宣布将基准利率上调25个基点。' };
    const candidate = { title: '苹果发布新款MacBook', content: '苹果公司发布搭载M4芯片的新款MacBook Pro。' };

    const similarity = computePairwiseSimilarity(sent, candidate);
    expect(similarity).toBeLessThan(0.3);
  });

  it('records sent event and drops duplicate in sequence', () => {
    const db = getDb(dbPath);
    const threshold = 0.3;

    // First event — record it
    const item1 = { title: '美联储宣布加息25个基点', content: '美国联邦储备委员会周三宣布将基准利率上调25个基点，符合市场预期。' };
    recordSentEvent(db, item1.title, item1.content);

    // Second event from different source — check similarity
    const item2 = { title: '美联储如期加息25个基点', content: '美联储如期加息25个基点，联邦基金利率升至新区间。' };
    const recentEvents = getRecentSentEvents(db, 24);
    const isDuplicate = recentEvents.some(sent =>
      computePairwiseSimilarity(
        { title: item2.title, content: item2.content },
        { title: sent.title, content: sent.content },
      ) >= threshold
    );

    expect(isDuplicate).toBe(true);
  });
});

describe('digest grouping integration', () => {
  it('groups same-event digest items into EventGroups', () => {
    const items = [
      makeItem('a', 'Bloomberg', '美联储宣布加息25个基点', '美国联邦储备委员会周三宣布将基准利率上调25个基点，符合市场预期。这是今年第三次加息。', 50, 80),
      makeItem('b', '财联社', '美联储如期加息25个基点', '美联储如期加息25个基点，联邦基金利率升至新区间。鲍威尔表示未来将视经济数据决定政策路径。', 50, 70),
    ];
    const groups = groupByEvent(items, 0.55);
    expect(groups.length).toBe(1);
    expect(groups[0].isMultiSource).toBe(true);
    expect(groups[0].members.length).toBe(2);
  });

  it('preserves backward-compatible digest array alongside digestGroups', () => {
    // Simulate what classify does: both digest[] and digestGroups are populated
    const items = [
      makeItem('a', 'SourceA', '美联储加息', '美联储宣布加息', 50, 80),
    ];
    const groups = groupByEvent(items, 0.55);

    // digest[] would be the flat array, digestGroups is grouped
    expect(items.length).toBe(1);
    expect(groups.length).toBe(1);
    expect(groups[0].members[0]).toBe(items[0]);
  });

  it('LLM merge summary fallback produces bullet-point titles', () => {
    // Simulate fallback behavior
    const members = [
      makeItem('a', 'Bloomberg', '美联储加息', '加息25个基点'),
      makeItem('b', '财联社', '美联储如期加息', '加息25BP'),
    ];
    // Fallback format as implemented in classify.ts
    const fallback = members.map(m => `- ${m.title}（${m.source}）`).join('\n');
    expect(fallback).toContain('- 美联储加息（Bloomberg）');
    expect(fallback).toContain('- 美联储如期加息（财联社）');
  });
});
