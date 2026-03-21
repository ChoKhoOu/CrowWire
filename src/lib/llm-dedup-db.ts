import Database from 'better-sqlite3'

export function initLlmDedupSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS llm_dedup_cache (
      pair_hash TEXT PRIMARY KEY,
      is_same INTEGER NOT NULL,
      checked_at INTEGER NOT NULL
    )
  `)
}

export function getLlmDedupResult(db: Database.Database, pairHash: string): boolean | null {
  const row = db.prepare('SELECT is_same FROM llm_dedup_cache WHERE pair_hash = ?').get(pairHash) as { is_same: number } | undefined
  return row !== undefined ? row.is_same === 1 : null
}

export function cacheLlmDedupResult(db: Database.Database, pairHash: string, isSame: boolean): void {
  db.prepare('INSERT OR REPLACE INTO llm_dedup_cache (pair_hash, is_same, checked_at) VALUES (?, ?, ?)').run(
    pairHash, isSame ? 1 : 0, Math.floor(Date.now() / 1000)
  )
}

export function cleanupLlmDedupCache(db: Database.Database, ttlHours: number): void {
  const cutoff = Math.floor(Date.now() / 1000) - ttlHours * 3600
  db.prepare('DELETE FROM llm_dedup_cache WHERE checked_at < ?').run(cutoff)
}
