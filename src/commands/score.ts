import { scoreBatch } from '../lib/llm.js';
import type { FeedItem } from '../types.js';
import { readStdin } from './shared.js';

export async function runScore(): Promise<void> {
  const input = await readStdin();
  const items: FeedItem[] = JSON.parse(input || '[]');

  if (items.length === 0) {
    process.stdout.write('[]');
    return;
  }

  const scored = await scoreBatch(items);
  process.stdout.write(JSON.stringify(scored));
}
