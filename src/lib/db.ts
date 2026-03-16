import Database from 'better-sqlite3';

let db: Database.Database | null = null;

function nowEpoch(): number {
  return Math.floor(Date.now() / 1000);
}

export function getDb(dbPath: string): Database.Database {
  if (!db) {
    db = new Database(dbPath, { timeout: 5000 });
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    initSchema(db);
  }
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

function initSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS seen_items (
      identity_hash TEXT NOT NULL,
      content_hash  TEXT NOT NULL,
      seen_at       INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_identity_hash ON seen_items(identity_hash);
    CREATE INDEX IF NOT EXISTS idx_content_hash ON seen_items(content_hash);
    CREATE INDEX IF NOT EXISTS idx_seen_at ON seen_items(seen_at);

    CREATE TABLE IF NOT EXISTS buffer (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      item_json   TEXT NOT NULL,
      score       INTEGER NOT NULL,
      buffered_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sent_events (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      title         TEXT NOT NULL,
      content       TEXT NOT NULL,
      sent_at       INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sent_events_at ON sent_events(sent_at);
  `);
}

export function isSeenItem(database: Database.Database, identityHash: string, contentHash: string): boolean {
  const row = database.prepare(
    'SELECT 1 FROM seen_items WHERE identity_hash = ? OR content_hash = ? LIMIT 1'
  ).get(identityHash, contentHash);
  return row !== undefined;
}

export function markSeen(database: Database.Database, identityHash: string, contentHash: string): void {
  database.prepare(
    'INSERT OR IGNORE INTO seen_items (identity_hash, content_hash, seen_at) VALUES (?, ?, ?)'
  ).run(identityHash, contentHash, nowEpoch());
}

export function cleanupExpired(database: Database.Database, ttlHours: number): number {
  const cutoff = nowEpoch() - ttlHours * 3600;
  const result = database.prepare('DELETE FROM seen_items WHERE seen_at < ?').run(cutoff);
  return result.changes;
}

export function bufferItem(database: Database.Database, itemJson: string, score: number): void {
  database.prepare(
    'INSERT INTO buffer (item_json, score, buffered_at) VALUES (?, ?, ?)'
  ).run(itemJson, score, nowEpoch());
}

export function drainBuffer(database: Database.Database): string[] {
  const rows = database.prepare('SELECT item_json FROM buffer ORDER BY score DESC').all() as Array<{ item_json: string }>;
  database.prepare('DELETE FROM buffer').run();
  return rows.map(r => r.item_json);
}

export function getLastDigestTime(database: Database.Database): number {
  const row = database.prepare("SELECT value FROM meta WHERE key = 'last_digest_at'").get() as { value: string } | undefined;
  return row ? parseInt(row.value, 10) : 0;
}

export function updateLastDigestTime(database: Database.Database): void {
  const now = nowEpoch();
  database.prepare(
    "INSERT OR REPLACE INTO meta (key, value) VALUES ('last_digest_at', ?)"
  ).run(String(now));
}

export function getRecentSentEvents(database: Database.Database, ttlHours: number = 24): Array<{ title: string; content: string }> {
  const cutoff = nowEpoch() - ttlHours * 3600;
  return database.prepare(
    'SELECT title, content FROM sent_events WHERE sent_at >= ?'
  ).all(cutoff) as Array<{ title: string; content: string }>;
}

export function recordSentEvent(database: Database.Database, title: string, content: string): void {
  database.prepare(
    'INSERT INTO sent_events (title, content, sent_at) VALUES (?, ?, ?)'
  ).run(title, content, nowEpoch());
}

export function cleanupExpiredSentEvents(database: Database.Database, ttlHours: number = 24): number {
  const cutoff = nowEpoch() - ttlHours * 3600;
  const result = database.prepare('DELETE FROM sent_events WHERE sent_at < ?').run(cutoff);
  return result.changes;
}
