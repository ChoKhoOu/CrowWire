import { createHash } from 'crypto';
import { uuidv7 } from 'uuidv7';
import { getEnv } from '../../config/env.js';
import { canonicalizeUrl } from './url-canonicalizer.js';
import { createChildLogger } from '../../shared/logger.js';
import type { RawFeedItem, CrowWireEvent } from '../../types/event.js';
import type { FeedConfig } from '../../types/feed.js';

const log = createChildLogger({ module: 'normalizer' });

export function normalize(raw: RawFeedItem, feedConfig: FeedConfig): CrowWireEvent | null {
  if (!raw.title || !raw.link) {
    log.debug({ raw: { title: raw.title, link: raw.link } }, 'Skipping item: missing title or link');
    return null;
  }

  const env = getEnv();
  const canonicalUrl = canonicalizeUrl(raw.link);

  // Truncate content if too large
  let content = raw.content || undefined;
  if (content && Buffer.byteLength(content, 'utf-8') > env.MAX_CONTENT_SIZE_BYTES) {
    content = Buffer.from(content, 'utf-8').subarray(0, env.MAX_CONTENT_SIZE_BYTES).toString('utf-8');
    log.debug({ url: canonicalUrl }, 'Content truncated to MAX_CONTENT_SIZE_BYTES');
  }

  const summary = raw.contentSnippet || raw.title;
  const publishedAt = raw.isoDate ? new Date(raw.isoDate) : (raw.pubDate ? new Date(raw.pubDate) : new Date());
  const identityHash = computeIdentityHash(raw.guid, canonicalUrl);
  const contentHash = computeContentHash(raw.title, summary, content);

  return {
    id: uuidv7(),
    source_type: feedConfig.source_type,
    source_name: feedConfig.name,
    source_route: feedConfig.route || feedConfig.url || '',
    guid: raw.guid,
    canonical_url: canonicalUrl,
    title: raw.title,
    summary,
    content,
    published_at: publishedAt,
    ingested_at: new Date(),
    identity_hash: identityHash,
    content_hash: contentHash,
    tags: feedConfig.tags,
  };
}

function computeIdentityHash(guid: string | undefined, canonicalUrl: string): string {
  const input = guid || canonicalUrl;
  return createHash('sha256').update(input).digest('hex');
}

function computeContentHash(title: string, summary: string, content?: string): string {
  const input = `${title}\n${summary}\n${content || ''}`;
  return createHash('sha256').update(input).digest('hex');
}
