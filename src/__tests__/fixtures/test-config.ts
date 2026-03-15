import type { Config } from '../../config/config.js';

/**
 * Inline vi.mock factory for the config module.
 * Because vitest hoists vi.mock() calls before imports are evaluated,
 * this object literal must be used directly inside the vi.mock factory:
 *
 *   vi.mock('../../config/config.js', () => {
 *     const cfg = { server: { ... }, ... };  // inline or copy from TEST_CONFIG_DEFAULTS
 *     return { loadConfig: vi.fn(() => cfg), getConfig: vi.fn(() => cfg) };
 *   });
 *
 * See normalizer.test.ts and deduper.test.ts for working examples.
 */
export const TEST_CONFIG_DEFAULTS = {
  server: { port: 3000, node_env: 'test' as const, log_level: 'error' as const },
  database: { url: 'postgresql://test:test@localhost:5432/test' },
  redis: { url: 'redis://localhost:6379' },
  llm: { provider: 'openai' as const, api_key: 'test-key', base_url: 'http://localhost:9999/v1', scoring_model: 'test-model', summarization_model: 'test-model' },
  feeds: { rsshub_base_url: 'http://localhost:1200', sources: [] as Config['feeds']['sources'] },
  delivery: { targets: [] as Config['delivery']['targets'] },
  scoring: { urgent_threshold: 85, batch_summarization_threshold: 20 },
  queue: { ingest_concurrency: 1, scorer_concurrency: 1, deliver_concurrency: 1, urgent_flush_interval_ms: 30000, batch_flush_interval_ms: 600000, batch_flush_count_threshold: 50 },
  dedup: { ttl_hours: 72, title_bucket_minutes: 30 },
  content: { max_size_bytes: 102400 },
} satisfies Config;

/**
 * Returns a complete Config object with test-safe defaults.
 * Pass overrides to customise specific fields.
 */
export function createTestConfig(overrides: Partial<Config> = {}): Config {
  return { ...TEST_CONFIG_DEFAULTS, ...overrides };
}
