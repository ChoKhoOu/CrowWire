import { createHash } from 'node:crypto';
import RssParser from 'rss-parser';
import type { FeedItem, FeedSource } from '../types.js';

const parser = new RssParser({ timeout: 10_000 });

export async function fetchFeed(feed: FeedSource, maxChars: number): Promise<FeedItem[]> {
  const parsed = await parser.parseURL(feed.url);
  const items: FeedItem[] = [];

  for (const entry of parsed.items) {
    const title = (entry.title ?? '').trim();
    const link = (entry.link ?? '').trim();
    if (!title || !link) continue;

    const rawContent = entry.contentSnippet ?? entry.content ?? '';
    const content = stripHtml(rawContent).slice(0, maxChars);

    items.push({
      id: sha256(`${link}|${title}`),
      title,
      link,
      content,
      published_at: entry.isoDate ?? new Date().toISOString(),
      source: feed.name,
      content_hash: sha256(`${title}|${content}`),
    });
  }

  return items;
}

export async function fetchAllFeeds(
  feeds: FeedSource[],
  maxChars: number,
  maxItems: number,
): Promise<FeedItem[]> {
  const enabled = feeds.filter(f => f.enabled);
  const results: FeedItem[] = [];

  for (const feed of enabled) {
    try {
      const items = await fetchFeed(feed, maxChars);
      results.push(...items);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[warn] Failed to fetch "${feed.name}": ${msg}\n`);
    }
  }

  // Sort newest first, cap at max
  results.sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime());
  return results.slice(0, maxItems);
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
