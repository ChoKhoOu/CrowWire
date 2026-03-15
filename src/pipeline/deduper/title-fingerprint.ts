import { createHash } from 'crypto';
import { getConfig } from '../../config/config.js';
import type { CrowWireEvent } from '../../types/event.js';

const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'in', 'on', 'at',
  'to', 'for', 'of', 'and', 'or', 'but', 'not', 'with', 'by', 'from',
  'that', 'this', 'it', 'its', 'has', 'had', 'have', 'be', 'been',
]);

export function computeTitleFingerprint(event: CrowWireEvent): string {
  const config = getConfig();
  // 1. Lowercase
  const lower = event.title.toLowerCase();
  // 2. Tokenize and remove stopwords
  const tokens = lower.split(/\s+/).filter(t => t.length > 0 && !STOPWORDS.has(t));
  // 3. Sort alphabetically
  tokens.sort();
  // 4. Build time bucket
  const bucketMs = config.dedup.title_bucket_minutes * 60 * 1000;
  const publishedMs = event.published_at.getTime();
  const bucket = Math.floor(publishedMs / bucketMs);
  // 5. Combine with source name
  const input = `${tokens.join(' ')}|${event.source_name}|${bucket}`;
  return createHash('sha256').update(input).digest('hex');
}
