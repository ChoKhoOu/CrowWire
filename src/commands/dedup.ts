import { getDb, closeDb, isSeenItem, markSeen, cleanupExpired } from '../lib/db.js';
import type { FeedItem } from '../types.js';
import { readStdin } from './shared.js';

export async function runDedup(dbPath: string, ttlHours: number = 72): Promise<void> {
  const input = await readStdin();
  const items: FeedItem[] = JSON.parse(input || '[]');

  const database = getDb(dbPath);

  try {
    const newItems: FeedItem[] = [];

    for (const item of items) {
      if (!isSeenItem(database, item.id, item.content_hash)) {
        markSeen(database, item.id, item.content_hash);
        newItems.push(item);
      }
    }

    // Cleanup expired entries
    const cleaned = cleanupExpired(database, ttlHours);
    if (cleaned > 0) {
      process.stderr.write(`[info] Cleaned ${cleaned} expired dedup entries\n`);
    }

    process.stdout.write(JSON.stringify(newItems));
  } finally {
    closeDb();
  }
}
