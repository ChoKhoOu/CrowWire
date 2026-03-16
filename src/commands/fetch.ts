import { loadConfig } from '../lib/config.js';
import { fetchAllFeeds } from '../lib/rss.js';

export async function runFetch(configPath: string, maxItems?: number): Promise<void> {
  const config = loadConfig(configPath);
  const limit = maxItems ?? config.settings.max_items_per_run;

  const items = await fetchAllFeeds(
    config.feeds,
    config.settings.content_max_chars,
    limit,
  );

  process.stdout.write(JSON.stringify(items));
}
