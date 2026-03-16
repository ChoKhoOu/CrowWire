import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  getDb, closeDb, isSeenItem, markSeen, cleanupExpired,
} from '../src/lib/db.js';
describe('dedup (db operations)', () => {
  let dbPath: string;

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'crowwire-dedup-'));
    dbPath = join(dir, 'test.db');
  });

  afterEach(() => {
    closeDb();
    try { unlinkSync(dbPath); } catch {}
  });

  it('marks and detects seen items by identity hash', () => {
    const db = getDb(dbPath);
    expect(isSeenItem(db, 'hash-a', 'chash-a')).toBe(false);
    markSeen(db, 'hash-a', 'chash-a');
    expect(isSeenItem(db, 'hash-a', 'chash-a')).toBe(true);
  });

  it('detects duplicates by content hash (different identity)', () => {
    const db = getDb(dbPath);
    markSeen(db, 'id-1', 'content-same');
    // Different identity hash but same content hash
    expect(isSeenItem(db, 'id-2', 'content-same')).toBe(true);
  });

  it('detects duplicates by identity hash (different content)', () => {
    const db = getDb(dbPath);
    markSeen(db, 'id-same', 'content-1');
    // Same identity hash but different content hash
    expect(isSeenItem(db, 'id-same', 'content-2')).toBe(true);
  });

  it('passes through genuinely new items', () => {
    const db = getDb(dbPath);
    markSeen(db, 'old-id', 'old-content');
    expect(isSeenItem(db, 'new-id', 'new-content')).toBe(false);
  });

  it('cleans up expired entries', () => {
    const db = getDb(dbPath);
    // Insert with an old timestamp (manually)
    const oldTime = Math.floor(Date.now() / 1000) - 73 * 3600; // 73 hours ago
    db.prepare('INSERT INTO seen_items (identity_hash, content_hash, seen_at) VALUES (?, ?, ?)')
      .run('old-hash', 'old-chash', oldTime);

    markSeen(db, 'new-hash', 'new-chash'); // fresh entry

    const cleaned = cleanupExpired(db, 72);
    expect(cleaned).toBe(1);

    // Old one should be gone
    expect(isSeenItem(db, 'old-hash', 'old-chash-different')).toBe(false);
    // New one should remain
    expect(isSeenItem(db, 'new-hash', 'new-chash')).toBe(true);
  });

  it('handles empty database gracefully', () => {
    const db = getDb(dbPath);
    expect(isSeenItem(db, 'any', 'any')).toBe(false);
    expect(cleanupExpired(db, 72)).toBe(0);
  });

  it('INSERT OR IGNORE prevents duplicate identity_hash errors', () => {
    const db = getDb(dbPath);
    markSeen(db, 'dup-id', 'content-1');
    // Should not throw
    markSeen(db, 'dup-id', 'content-2');
  });
});
