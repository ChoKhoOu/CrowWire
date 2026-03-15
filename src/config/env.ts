import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  RSSHUB_BASE_URL: z.string().min(1).default('http://localhost:1200'),

  ANTHROPIC_API_KEY: z.string().min(1),
  SCORING_MODEL: z.string().default('claude-haiku-4-5-20250315'),

  URGENT_FLUSH_INTERVAL_MS: z.coerce.number().default(30000),
  BATCH_FLUSH_INTERVAL_MS: z.coerce.number().default(600000),
  BATCH_FLUSH_COUNT_THRESHOLD: z.coerce.number().default(50),
  SCORER_CONCURRENCY: z.coerce.number().default(10),
  INGEST_CONCURRENCY: z.coerce.number().default(5),
  DELIVER_CONCURRENCY: z.coerce.number().default(3),

  URGENT_SCORE_THRESHOLD: z.coerce.number().default(85),

  OPENCLAW_GATEWAY_URL: z.string().min(1).default('http://localhost:18789'),
  OPENCLAW_HOOKS_TOKEN: z.string().min(1),
  OPENCLAW_HOOKS_PATH: z.string().default('/hooks'),
  OPENCLAW_DELIVERY_CHANNEL: z.string().default('last'),

  SUMMARIZATION_MODEL: z.string().default('claude-sonnet-4-6-20250315'),
  BATCH_SUMMARIZATION_THRESHOLD: z.coerce.number().default(20),

  DEDUP_TTL_HOURS: z.coerce.number().default(72),
  DEDUP_TITLE_BUCKET_MINUTES: z.coerce.number().default(30),

  MAX_CONTENT_SIZE_BYTES: z.coerce.number().default(102400),
});

export type Env = z.infer<typeof envSchema>;

let _env: Env | null = null;

export function loadEnv(): Env {
  if (_env) return _env;
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid environment variables:', result.error.flatten().fieldErrors);
    process.exit(1);
  }
  _env = result.data;
  return _env;
}

export function getEnv(): Env {
  if (!_env) return loadEnv();
  return _env;
}
