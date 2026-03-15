import { getConfig } from '../../config/config.js';
import { createChildLogger } from '../../shared/logger.js';
import { TransientError } from '../../types/errors.js';
import type { RawFeedItem } from '../../types/event.js';

const log = createChildLogger({ module: 'rsshub-client' });

interface RSSHubItem {
  title?: string;
  link?: string;
  id?: string;
  guid?: string;
  pubDate?: string;
  description?: string;
  content?: string;
  author?: string;
}

interface RSSHubResponse {
  items?: RSSHubItem[];
}

export async function fetchRSSHubFeed(route: string): Promise<RawFeedItem[]> {
  const config = getConfig();
  const url = `${config.feeds.rsshub_base_url}${route}?format=json&filter_time=3600`;

  log.debug({ url }, 'Fetching RSSHub feed');

  const response = await fetch(url, {
    headers: { 'User-Agent': 'CrowWire/0.1.0' },
    signal: AbortSignal.timeout(15000),
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new TransientError(`RSSHub returned ${response.status} for ${route}`);
  }

  const data = await response.json() as RSSHubResponse;
  const items = data.items || [];

  return items.map(item => ({
    title: item.title,
    link: item.link,
    guid: item.guid || item.id,
    pubDate: item.pubDate,
    content: item.content || item.description,
    contentSnippet: item.description,
    isoDate: item.pubDate,
  }));
}
