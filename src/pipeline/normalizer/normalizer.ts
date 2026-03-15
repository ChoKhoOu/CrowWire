import { createHash } from 'crypto';
import { uuidv7 } from 'uuidv7';
import { getConfig } from '../../config/config.js';
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

  const config = getConfig();
  const canonicalUrl = canonicalizeUrl(raw.link);

  // Truncate content if too large
  let content = raw.content || undefined;
  if (content && Buffer.byteLength(content, 'utf-8') > config.content.max_size_bytes) {
    // Truncate at byte level, then remove any trailing incomplete UTF-8 character
    content = Buffer.from(content, 'utf-8')
      .subarray(0, config.content.max_size_bytes)
      .toString('utf-8')
      .replace(/\uFFFD/g, '');
    log.debug({ url: canonicalUrl }, 'Content truncated to max_size_bytes');
  }

  const summary = raw.contentSnippet || raw.title;
  const publishedAt = raw.isoDate ? new Date(raw.isoDate) : (raw.pubDate ? new Date(raw.pubDate) : new Date());
  const identityHash = createHash('sha256').update(raw.guid || canonicalUrl).digest('hex');
  const contentHash = createHash('sha256').update(`${raw.title}\n${summary}\n${content || ''}`).digest('hex');

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
