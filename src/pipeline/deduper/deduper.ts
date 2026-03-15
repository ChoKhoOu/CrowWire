import { getRedisConnection } from '../../queue/connection.js';
import { getConfig } from '../../config/config.js';
import { REDIS_KEYS } from '../../config/constants.js';
import { createChildLogger } from '../../shared/logger.js';
import { computeIdentityHash } from './identity-hash.js';
import { computeContentHash } from './content-hash.js';
import { computeTitleFingerprint } from './title-fingerprint.js';
import type { CrowWireEvent } from '../../types/event.js';

const log = createChildLogger({ module: 'deduper' });

export interface DedupResult {
  is_duplicate: boolean;
  matched_strategy?: 'identity' | 'content' | 'title_fingerprint';
  matched_event_id?: string;
}

export async function deduplicate(event: CrowWireEvent): Promise<DedupResult> {
  const redis = getRedisConnection();
  const config = getConfig();
  const ttlSeconds = config.dedup.ttl_hours * 3600;

  // Strategy 1: Identity hash (guid or canonical URL)
  const identityHash = computeIdentityHash(event);
  const identityKey = `${REDIS_KEYS.DEDUP_PREFIX}id:${identityHash}`;
  const identityResult = await redis.set(identityKey, event.id, 'EX', ttlSeconds, 'NX');
  if (!identityResult) {
    const existingId = await redis.get(identityKey);
    log.debug({ eventId: event.id, strategy: 'identity', existingId }, 'Duplicate detected');
    return { is_duplicate: true, matched_strategy: 'identity', matched_event_id: existingId || undefined };
  }

  // Strategy 2: Content hash
  const contentHash = computeContentHash(event);
  const contentKey = `${REDIS_KEYS.DEDUP_PREFIX}content:${contentHash}`;
  const contentResult = await redis.set(contentKey, event.id, 'EX', ttlSeconds, 'NX');
  if (!contentResult) {
    const existingId = await redis.get(contentKey);
    log.debug({ eventId: event.id, strategy: 'content', existingId }, 'Duplicate detected');
    return { is_duplicate: true, matched_strategy: 'content', matched_event_id: existingId || undefined };
  }

  // Strategy 3: Title fingerprint
  const titleFp = computeTitleFingerprint(event);
  const titleKey = `${REDIS_KEYS.DEDUP_PREFIX}title:${titleFp}`;
  const titleResult = await redis.set(titleKey, event.id, 'EX', ttlSeconds, 'NX');
  if (!titleResult) {
    const existingId = await redis.get(titleKey);
    log.debug({ eventId: event.id, strategy: 'title_fingerprint', existingId }, 'Duplicate detected');
    return { is_duplicate: true, matched_strategy: 'title_fingerprint', matched_event_id: existingId || undefined };
  }

  return { is_duplicate: false };
}
