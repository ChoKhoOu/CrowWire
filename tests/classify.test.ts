import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  getDb, closeDb, bufferItem, updateLastDigestTime,
  drainBuffer, getLastDigestTime,
} from '../src/lib/db.js';
import type { ScoredItem, ClassifyOutput } from '../src/types.js';

function makeScored(id: string, urgency: number, relevance: number = 50): ScoredItem {
  return {
    id,
    title: `Title ${id}`,
    link: `https://example.com/${id}`,
    content: `Content ${id}`,
    published_at: new Date().toISOString(),
    source: 'test',
    content_hash: `ch-${id}`,
    urgency,
    relevance,
    novelty: 50,
  };
}

function classifyItems(
  dbPath: string,
  items: ScoredItem[],
  threshold: number = 85,
  digestIntervalMinutes: number = 15,
): ClassifyOutput {
  const database = getDb(dbPath);

  const urgent: ScoredItem[] = [];
  let buffered = 0;

  for (const item of items) {
    if (item.urgency >= threshold) {
      urgent.push(item);
    } else {
      bufferItem(database, JSON.stringify(item), item.relevance);
      buffered++;
    }
  }

  const lastDigest = getLastDigestTime(database);
  const now = Math.floor(Date.now() / 1000);
  const elapsed = now - lastDigest;
  const intervalSeconds = digestIntervalMinutes * 60;

  let digest: ScoredItem[] = [];
  let digestFlushed = 0;

  if (elapsed >= intervalSeconds) {
    const drained = drainBuffer(database);
    digest = drained.map((json: string) => JSON.parse(json) as ScoredItem);
    digestFlushed = digest.length;
    if (digestFlushed > 0 || lastDigest === 0) {
      updateLastDigestTime(database);
    }
  }

  return {
    urgent,
    digest,
    has_urgent: urgent.length > 0,
    has_digest: digest.length > 0,
    has_output: urgent.length > 0 || digest.length > 0,
    stats: { new_items: items.length, buffered, digest_flushed: digestFlushed },
  };
}

describe('classify logic', () => {
  let dbPath: string;

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'crowwire-classify-'));
    dbPath = join(dir, 'test.db');
  });

  afterEach(() => {
    closeDb();
    try { unlinkSync(dbPath); } catch {}
  });

  it('classifies all urgent items correctly', () => {
    const items = [makeScored('a', 90), makeScored('b', 95)];
    const result = classifyItems(dbPath, items);
    expect(result.urgent).toHaveLength(2);
    expect(result.has_urgent).toBe(true);
    expect(result.stats.buffered).toBe(0);
  });

  it('classifies all normal items (buffered)', () => {
    const items = [makeScored('a', 50), makeScored('b', 70)];
    const result = classifyItems(dbPath, items);
    expect(result.urgent).toHaveLength(0);
    expect(result.has_urgent).toBe(false);
    expect(result.stats.buffered).toBe(2);
  });

  it('splits mixed items at threshold boundary', () => {
    const items = [
      makeScored('urgent', 85),
      makeScored('normal', 84),
    ];
    const result = classifyItems(dbPath, items);
    expect(result.urgent).toHaveLength(1);
    expect(result.urgent[0].id).toBe('urgent');
    expect(result.stats.buffered).toBe(1);
  });

  it('flushes digest when interval elapsed (first run, no prior digest)', () => {
    // First run: lastDigest = 0, so elapsed is always >= interval
    const items = [makeScored('a', 50)];
    const result = classifyItems(dbPath, items);
    // Item gets buffered, then immediately flushed as digest (since no prior digest)
    expect(result.has_digest).toBe(true);
    expect(result.digest).toHaveLength(1);
    expect(result.stats.digest_flushed).toBe(1);
  });

  it('does NOT flush digest when interval has not elapsed', () => {
    const database = getDb(dbPath);
    // Set last digest to "just now"
    updateLastDigestTime(database);
    closeDb();

    const items = [makeScored('a', 50)];
    const result = classifyItems(dbPath, items, 85, 15);
    expect(result.has_digest).toBe(false);
    expect(result.digest).toHaveLength(0);
    expect(result.stats.buffered).toBe(1);
  });

  it('handles empty input', () => {
    const result = classifyItems(dbPath, []);
    expect(result.urgent).toHaveLength(0);
    expect(result.has_urgent).toBe(false);
    expect(result.has_output).toBe(false);
    expect(result.stats.new_items).toBe(0);
  });

  it('flushes previously buffered items on digest interval', () => {
    const database = getDb(dbPath);
    // Set last digest to 20 minutes ago
    const twentyMinAgo = Math.floor(Date.now() / 1000) - 20 * 60;
    database.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('last_digest_at', ?)").run(String(twentyMinAgo));
    // Buffer some items directly
    bufferItem(database, JSON.stringify(makeScored('old-1', 40, 80)), 80);
    bufferItem(database, JSON.stringify(makeScored('old-2', 30, 60)), 60);
    closeDb();

    // Classify with new item
    const items = [makeScored('new-normal', 50, 70)];
    const result = classifyItems(dbPath, items, 85, 15);

    expect(result.has_digest).toBe(true);
    // Should contain the 2 previously buffered + 1 newly buffered
    expect(result.digest).toHaveLength(3);
    expect(result.stats.digest_flushed).toBe(3);
  });
});
