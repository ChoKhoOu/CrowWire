import Parser from 'rss-parser';
import type { RawFeedItem } from '../../types/event.js';

const parser = new Parser({
  timeout: 15000,
  headers: { 'User-Agent': 'CrowWire/0.1.0' },
});

export async function parseRssFeed(url: string): Promise<RawFeedItem[]> {
  const feed = await parser.parseURL(url);
  return (feed.items || []).map(item => ({
    title: item.title,
    link: item.link,
    guid: item.guid || item.id,
    pubDate: item.pubDate,
    content: item.content || item['content:encoded'],
    contentSnippet: item.contentSnippet,
    isoDate: item.isoDate,
  }));
}
