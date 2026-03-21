import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import Database from 'better-sqlite3'
import { FlushQueue, QueueManager, type QueueItem } from '../src/lib/queue.js'
import { initQueueSchema, persistUrgentItem, loadUrgentItems, clearUrgentQueue } from '../src/lib/queue-db.js'
import type { ScoredItem } from '../src/types.js'

function makeScored(id: string, urgency: number): ScoredItem {
  return {
    id,
    title: `Title ${id}`,
    link: `https://example.com/${id}`,
    content: `Content ${id}`,
    published_at: new Date().toISOString(),
    source: 'test',
    content_hash: `ch-${id}`,
    urgency,
    relevance: 50,
    novelty: 50,
  }
}

function makeQueueItem(id: string, urgency: number = 80): QueueItem {
  return { message: makeScored(id, urgency), queuedAt: Math.floor(Date.now() / 1000) }
}

function openTestDb(): { db: Database.Database; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'crowwire-queue-'))
  const db = new Database(join(dir, 'test.db'))
  initQueueSchema(db)
  return { db, dir }
}

describe('FlushQueue', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  // 1. enqueue increases size
  it('enqueue increases size', () => {
    const q = new FlushQueue('urgent', 10000)
    expect(q.size()).toBe(0)
    q.enqueue(makeQueueItem('a'))
    expect(q.size()).toBe(1)
    q.enqueue(makeQueueItem('b'))
    expect(q.size()).toBe(2)
  })

  // 2. time-based flush
  it('time-based flush calls callback with items after interval', async () => {
    vi.useFakeTimers()
    const q = new FlushQueue('normal', 5000)
    const item = makeQueueItem('a')
    q.enqueue(item)

    const callback = vi.fn().mockResolvedValue(undefined)
    q.start(callback)

    await vi.advanceTimersByTimeAsync(5000)

    expect(callback).toHaveBeenCalledOnce()
    expect(callback).toHaveBeenCalledWith([item])
    q.stop()
  })

  // 3. count-based flush
  it('count-based flush triggers immediately when threshold reached', async () => {
    const q = new FlushQueue('urgent', 60000, 3)
    const callback = vi.fn().mockResolvedValue(undefined)
    q.start(callback)

    q.enqueue(makeQueueItem('a'))
    q.enqueue(makeQueueItem('b'))
    expect(callback).not.toHaveBeenCalled()
    q.enqueue(makeQueueItem('c')) // triggers flush

    // Allow async flush to settle
    await Promise.resolve()
    await Promise.resolve()

    expect(callback).toHaveBeenCalledOnce()
    expect(callback.mock.calls[0][0]).toHaveLength(3)
    q.stop()
  })

  // 4. empty flush is no-op
  it('empty queue flush does not invoke callback', async () => {
    vi.useFakeTimers()
    const q = new FlushQueue('normal', 1000)
    const callback = vi.fn().mockResolvedValue(undefined)
    q.start(callback)

    await vi.advanceTimersByTimeAsync(1000)

    expect(callback).not.toHaveBeenCalled()
    q.stop()
  })

  // 5. re-enqueues on flush failure
  it('re-enqueues items when flush callback throws', async () => {
    vi.useFakeTimers()
    const q = new FlushQueue('normal', 1000)
    q.enqueue(makeQueueItem('x'))
    q.enqueue(makeQueueItem('y'))

    const callback = vi.fn().mockRejectedValue(new Error('network error'))
    q.start(callback)

    await vi.advanceTimersByTimeAsync(1000)
    // Let the async rejection propagate
    await Promise.resolve()
    await Promise.resolve()

    expect(callback).toHaveBeenCalledOnce()
    expect(q.size()).toBe(2) // items restored
    q.stop()
  })

  // 6. urgent persistence — verify persistUrgentItem called
  it('urgent queue persists items to SQLite on enqueue', () => {
    const { db, dir } = openTestDb()
    try {
      const q = new FlushQueue('urgent', 60000)
      q.setDb(db)

      const item = makeQueueItem('persist-me')
      q.enqueue(item)

      const rows = loadUrgentItems(db)
      expect(rows).toHaveLength(1)
      expect(JSON.parse(rows[0].item_json)).toMatchObject({ id: 'persist-me' })
    } finally {
      db.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // 7. urgent recovery from DB
  it('recover() loads persisted urgent items into queue', () => {
    const { db, dir } = openTestDb()
    try {
      const now = Math.floor(Date.now() / 1000)
      persistUrgentItem(db, JSON.stringify(makeScored('rec-1', 90)), now - 10)
      persistUrgentItem(db, JSON.stringify(makeScored('rec-2', 95)), now - 5)

      const q = new FlushQueue('urgent', 60000)
      q.recover(db)

      expect(q.size()).toBe(2)
    } finally {
      db.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // 8. urgent clears DB on successful flush
  it('urgent queue clears DB after successful flush', async () => {
    vi.useFakeTimers()
    const { db, dir } = openTestDb()
    try {
      const q = new FlushQueue('urgent', 2000)
      q.setDb(db)

      q.enqueue(makeQueueItem('clear-me'))
      expect(loadUrgentItems(db)).toHaveLength(1)

      const callback = vi.fn().mockResolvedValue(undefined)
      q.start(callback)

      await vi.advanceTimersByTimeAsync(2000)
      await Promise.resolve()
      await Promise.resolve()

      expect(callback).toHaveBeenCalledOnce()
      expect(loadUrgentItems(db)).toHaveLength(0)
      q.stop()
    } finally {
      db.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('QueueManager', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  // 9. dispatch routes correctly
  it('dispatch routes items above threshold to urgent, below to normal', () => {
    const mgr = new QueueManager(10000, 0, 900000)
    const threshold = 75

    const result1 = mgr.dispatch(makeScored('high', 80), threshold)
    const result2 = mgr.dispatch(makeScored('low', 60), threshold)
    const result3 = mgr.dispatch(makeScored('exact', 75), threshold) // >= threshold → urgent

    expect(result1).toBe('urgent')
    expect(result2).toBe('normal')
    expect(result3).toBe('urgent')

    // After all dispatches: 2 urgent (high + exact), 1 normal (low)
    expect(mgr.urgent.size()).toBe(2)
    expect(mgr.normal.size()).toBe(1)
  })

  // 10. start/stop lifecycle
  it('start and stop manage timers without throwing', () => {
    vi.useFakeTimers()
    const mgr = new QueueManager(5000, 3, 900000)
    const urgentCb = vi.fn().mockResolvedValue(undefined)
    const normalCb = vi.fn().mockResolvedValue(undefined)

    mgr.start(urgentCb, normalCb)
    mgr.stop()
    // Advance time — no callbacks should fire after stop
    vi.advanceTimersByTime(10000)

    expect(urgentCb).not.toHaveBeenCalled()
    expect(normalCb).not.toHaveBeenCalled()
  })

  // 11. QueueManager recover loads urgent items
  it('recover() loads urgent items into the urgent queue', () => {
    const { db, dir } = openTestDb()
    try {
      const now = Math.floor(Date.now() / 1000)
      persistUrgentItem(db, JSON.stringify(makeScored('mgr-rec', 90)), now)

      const mgr = new QueueManager(10000, 0, 900000)
      mgr.recover(db)

      expect(mgr.urgent.size()).toBe(1)
      expect(mgr.normal.size()).toBe(0)
    } finally {
      db.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('queue-db helpers', () => {
  it('initQueueSchema + persistUrgentItem + loadUrgentItems + clearUrgentQueue round-trip', () => {
    const { db, dir } = openTestDb()
    try {
      const now = Math.floor(Date.now() / 1000)
      persistUrgentItem(db, '{"id":"a"}', now)
      persistUrgentItem(db, '{"id":"b"}', now + 1)

      const rows = loadUrgentItems(db)
      expect(rows).toHaveLength(2)
      expect(rows[0].item_json).toBe('{"id":"a"}')
      expect(rows[1].item_json).toBe('{"id":"b"}')

      clearUrgentQueue(db)
      expect(loadUrgentItems(db)).toHaveLength(0)
    } finally {
      db.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
