import { readFileSync } from 'fs';
import { parse } from 'yaml';
import { z } from 'zod';

const feedSourceSchema = z.object({
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

const deliveryFilterSchema = z.object({
  min_urgency: z.number().min(0).max(100).default(0),
});

const discordTargetSchema = z.object({
  name: z.string().min(1),
  type: z.literal('discord'),
  enabled: z.boolean(),
  webhook_url: z.string().url(),
  filter: deliveryFilterSchema.default({}),
});

const openclawTargetSchema = z.object({
  name: z.string().min(1),
  type: z.literal('openclaw'),
  enabled: z.boolean(),
  gateway_url: z.string().url(),
  hooks_token: z.string().min(1),
  hooks_path: z.string().default('/hooks').refine(
    (p) => p.startsWith('/') && !p.includes('..') && !p.includes('//'),
    { message: 'hooks_path must be an absolute path with no traversal sequences' }
  ),
  channel: z.string().default('last'),
  filter: deliveryFilterSchema.default({}),
});

const deliveryTargetSchema = z.discriminatedUnion('type', [
  discordTargetSchema,
  openclawTargetSchema,
]);

const configSchema = z.object({
  server: z.object({
    port: z.number().default(3000),
    node_env: z.enum(['development', 'production', 'test']).default('development'),
    log_level: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  }).default({}),
  redis: z.object({
    url: z.string().min(1).default('redis://localhost:6379'),
  }).default({}),
  llm: z.object({
    provider: z.enum(['openai', 'anthropic']).default('openai'),
    api_key: z.string().min(1),
    base_url: z.string().default(''),
    scoring_model: z.string().default('gpt-4o-mini'),
    summarization_model: z.string().default('gpt-4o-mini'),
  }),
  feeds: z.object({
    rsshub_base_url: z.string().min(1).default('http://localhost:1200'),
    sources: z.array(feedSourceSchema),
  }),
  delivery: z.object({
    targets: z.array(deliveryTargetSchema).default([]),
  }).default({}),
  scoring: z.object({
    urgent_threshold: z.number().default(85),
    batch_summarization_threshold: z.number().default(20),
  }).default({}),
  queue: z.object({
    ingest_concurrency: z.number().default(5),
    scorer_concurrency: z.number().default(10),
    deliver_concurrency: z.number().default(3),
    urgent_flush_interval_ms: z.number().default(30000),
    batch_flush_interval_ms: z.number().default(600000),
    batch_flush_count_threshold: z.number().default(50),
  }).default({}),
  dedup: z.object({
    ttl_hours: z.number().default(72),
    title_bucket_minutes: z.number().default(30),
  }).default({}),
  content: z.object({
    max_size_bytes: z.number().default(102400),
  }).default({}),
});

export type Config = z.infer<typeof configSchema>;

let _config: Config | null = null;

export function loadConfig(): Config {
  if (_config) return _config;

  const configPath = process.env.CONFIG_PATH || 'config.yaml';

  let raw: string;
  try {
    raw = readFileSync(configPath, 'utf-8');
  } catch (err) {
    console.error(`Failed to read config file at ${configPath}:`, err instanceof Error ? err.message : err);
    process.exit(1);
  }

  const parsed = parse(raw);
  const result = configSchema.safeParse(parsed);
  if (!result.success) {
    console.error('Invalid configuration:', result.error.flatten().fieldErrors);
    process.exit(1);
  }

  _config = result.data;

  // Set process.env for logger.ts (reads env at import time)
  process.env.LOG_LEVEL = _config.server.log_level;
  process.env.NODE_ENV = _config.server.node_env;

  return _config;
}

export function getConfig(): Config {
  if (!_config) return loadConfig();
  return _config;
}
