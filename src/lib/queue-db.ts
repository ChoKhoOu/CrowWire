import type Database from 'better-sqlite3'

export function initQueueSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS urgent_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_json TEXT NOT NULL,
      queued_at INTEGER NOT NULL
    )
  `)
}

export function persistUrgentItem(db: Database.Database, itemJson: string, queuedAt: number): void {
  db.prepare('INSERT INTO urgent_queue (item_json, queued_at) VALUES (?, ?)').run(itemJson, queuedAt)
}

export function loadUrgentItems(db: Database.Database): Array<{ id: number; item_json: string; queued_at: number }> {
  return db.prepare('SELECT id, item_json, queued_at FROM urgent_queue ORDER BY queued_at ASC').all() as Array<{ id: number; item_json: string; queued_at: number }>
}

export function clearUrgentQueue(db: Database.Database, maxId?: number): void {
  if (maxId !== undefined) {
    db.prepare('DELETE FROM urgent_queue WHERE id <= ?').run(maxId)
  } else {
    db.prepare('DELETE FROM urgent_queue').run()
  }
}

export function getMaxUrgentId(db: Database.Database): number | null {
  const row = db.prepare('SELECT MAX(id) as max_id FROM urgent_queue').get() as { max_id: number | null } | undefined
  return row?.max_id ?? null
}
