import type Database from 'better-sqlite3'
import type { ScoredItem, EventGroup, QueueType } from '../types.js'
import { persistUrgentItem, loadUrgentItems, clearUrgentQueue, getMaxUrgentId } from './queue-db.js'

export interface QueueItem {
  message: ScoredItem | EventGroup
  queuedAt: number
}

export type FlushCallback = (items: QueueItem[]) => Promise<void>

export class FlushQueue {
  readonly type: QueueType
  private items: QueueItem[] = []
  private flushInterval: number  // ms
  private flushCount: number     // 0 = disabled
  private timer: ReturnType<typeof setTimeout> | null = null
  private callback: FlushCallback | null = null
  private db: Database.Database | null = null

  constructor(type: QueueType, flushInterval: number, flushCount: number = 0) {
    this.type = type
    this.flushInterval = flushInterval
    this.flushCount = flushCount
  }

  setDb(db: Database.Database): void {
    this.db = db
  }

  enqueue(item: QueueItem): void {
    this.items.push(item)

    // Persist urgent items to SQLite for crash recovery
    if (this.type === 'urgent' && this.db) {
      persistUrgentItem(this.db, JSON.stringify(item.message), item.queuedAt)
    }

    // Check count threshold for immediate flush
    if (this.flushCount > 0 && this.items.length >= this.flushCount) {
      this.triggerFlush()
    }
  }

  start(callback: FlushCallback): void {
    this.callback = callback
    this.scheduleFlush()
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  size(): number {
    return this.items.length
  }

  /** Recover persisted urgent items from DB on startup */
  recover(db: Database.Database): void {
    if (this.type !== 'urgent') return
    const rows = loadUrgentItems(db)
    for (const row of rows) {
      try {
        const message = JSON.parse(row.item_json)
        this.items.push({ message, queuedAt: row.queued_at })
      } catch {
        // Skip corrupt entries
      }
    }
    if (this.items.length > 0) {
      process.stderr.write(`[queue] Recovered ${this.items.length} urgent items from DB\n`)
    }
  }

  private scheduleFlush(): void {
    this.timer = setTimeout(() => {
      this.triggerFlush()
      if (this.callback) this.scheduleFlush() // reschedule
    }, this.flushInterval)
  }

  private async triggerFlush(): Promise<void> {
    if (this.items.length === 0) return

    // Capture max DB id BEFORE draining to avoid deleting items enqueued during flush
    const maxId = (this.type === 'urgent' && this.db) ? getMaxUrgentId(this.db) : null
    const flushed = this.items.splice(0) // drain

    if (this.callback) {
      try {
        await this.callback(flushed)
        // Clear only the persisted items that were actually flushed
        if (this.type === 'urgent' && this.db && maxId !== null) {
          clearUrgentQueue(this.db, maxId)
        }
      } catch (err) {
        process.stderr.write(`[queue] Flush failed for ${this.type}: ${(err as Error).message}\n`)
        // Re-enqueue on failure (without re-persisting)
        this.items.unshift(...flushed)
      }
    }
  }
}

export class QueueManager {
  readonly urgent: FlushQueue
  readonly normal: FlushQueue

  constructor(
    urgentFlushInterval: number,
    urgentFlushCount: number,
    digestFlushInterval: number
  ) {
    this.urgent = new FlushQueue('urgent', urgentFlushInterval, urgentFlushCount)
    this.normal = new FlushQueue('normal', digestFlushInterval, 0)
  }

  dispatch(item: ScoredItem, urgencyThreshold: number): QueueType {
    const queueItem: QueueItem = { message: item, queuedAt: Math.floor(Date.now() / 1000) }
    if (item.urgency >= urgencyThreshold) {
      this.urgent.enqueue(queueItem)
      return 'urgent'
    } else {
      this.normal.enqueue(queueItem)
      return 'normal'
    }
  }

  start(urgentCallback: FlushCallback, normalCallback: FlushCallback): void {
    this.urgent.start(urgentCallback)
    this.normal.start(normalCallback)
  }

  stop(): void {
    this.urgent.stop()
    this.normal.stop()
  }

  setDb(db: Database.Database): void {
    this.urgent.setDb(db)
    this.normal.setDb(db)
  }

  recover(db: Database.Database): void {
    this.urgent.recover(db)
  }
}
