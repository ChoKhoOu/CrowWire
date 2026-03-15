import { readFileSync } from 'fs';
import { parse } from 'yaml';
import { z } from 'zod';
import path from 'path';
import type { FeedConfig } from '../types/feed.js';

const feedConfigSchema = z.object({
  name: z.string().min(1),
  source_type: z.enum(['rss', 'rsshub']),
  route: z.string().optional(),
  url: z.string().url().optional(),
  poll_interval_ms: z.number().min(10000),
  enabled: z.boolean(),
  tags: z.array(z.string()),
}).refine(
  (data) => {
    if (data.source_type === 'rsshub') return !!data.route;
    if (data.source_type === 'rss') return !!data.url;
    return false;
  },
  { message: 'rsshub feeds require route, rss feeds require url' }
);

const feedsFileSchema = z.object({
  feeds: z.array(feedConfigSchema),
});

export function loadFeeds(configPath?: string): FeedConfig[] {
  const filePath = configPath || path.resolve(process.cwd(), 'feeds.config.yaml');
  const raw = readFileSync(filePath, 'utf-8');
  const parsed = parse(raw);
  const result = feedsFileSchema.safeParse(parsed);
  if (!result.success) {
    console.error('Invalid feed configuration:', result.error.flatten());
    process.exit(1);
  }
  return result.data.feeds;
}

export function getEnabledFeeds(configPath?: string): FeedConfig[] {
  return loadFeeds(configPath).filter(f => f.enabled);
}
