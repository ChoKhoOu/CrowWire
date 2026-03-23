import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { loadCrowWireConfig } from '../src/lib/config-loader.js';

const TMP_DIR = join(import.meta.dirname ?? '.', '.tmp-config-test');

const ENV_KEYS = [
  'LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL',
  'DISCORD_BOT_TOKEN',
  'FETCH_INTERVAL', 'URGENT_FLUSH_INTERVAL', 'URGENT_FLUSH_COUNT',
  'DIGEST_FLUSH_INTERVAL', 'URGENCY_THRESHOLD', 'SIMILARITY_THRESHOLD',
  'DEDUP_TTL_HOURS', 'SENT_EVENT_TTL_HOURS', 'CONTENT_MAX_CHARS',
  'MAX_ITEMS_PER_RUN',
  'FEEDS_CONFIG', 'TARGETS_CONFIG', 'FILTERS_CONFIG',
];

describe('loadCrowWireConfig', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    mkdirSync(TMP_DIR, { recursive: true });
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
    rmSync(TMP_DIR, { recursive: true, force: true });
  });

  it('populates env vars from config.yaml', () => {
    writeFileSync(join(TMP_DIR, 'config.yaml'), `
llm:
  base_url: https://api.test.com/v1
  api_key: sk-test-key
  model: gpt-4o
discord:
  bot_token: test-bot-token
daemon:
  fetch_interval: 30000
  urgency_threshold: 80
`);

    loadCrowWireConfig(TMP_DIR);

    expect(process.env.LLM_BASE_URL).toBe('https://api.test.com/v1');
    expect(process.env.LLM_API_KEY).toBe('sk-test-key');
    expect(process.env.LLM_MODEL).toBe('gpt-4o');
    expect(process.env.DISCORD_BOT_TOKEN).toBe('test-bot-token');
    expect(process.env.FETCH_INTERVAL).toBe('30000');
    expect(process.env.URGENCY_THRESHOLD).toBe('80');
  });

  it('does not overwrite existing env vars', () => {
    process.env.LLM_API_KEY = 'existing-key';

    writeFileSync(join(TMP_DIR, 'config.yaml'), `
llm:
  api_key: yaml-key
  base_url: https://api.test.com/v1
  model: gpt-4o
`);

    loadCrowWireConfig(TMP_DIR);

    expect(process.env.LLM_API_KEY).toBe('existing-key');
    expect(process.env.LLM_BASE_URL).toBe('https://api.test.com/v1');
  });

  it('sets config file paths based on configDir', () => {
    writeFileSync(join(TMP_DIR, 'config.yaml'), 'llm:\n  base_url: x\n');

    loadCrowWireConfig(TMP_DIR);

    expect(process.env.FEEDS_CONFIG).toBe(join(TMP_DIR, 'feeds.yaml'));
    expect(process.env.TARGETS_CONFIG).toBe(join(TMP_DIR, 'targets.yaml'));
    expect(process.env.FILTERS_CONFIG).toBe(join(TMP_DIR, 'filters.yaml'));
  });

  it('silently does nothing when config.yaml is missing', () => {
    loadCrowWireConfig(TMP_DIR);

    expect(process.env.LLM_BASE_URL).toBeUndefined();
    expect(process.env.LLM_API_KEY).toBeUndefined();
  });

  it('handles empty config.yaml', () => {
    writeFileSync(join(TMP_DIR, 'config.yaml'), '');

    loadCrowWireConfig(TMP_DIR);

    expect(process.env.LLM_BASE_URL).toBeUndefined();
  });

  it('handles config.yaml with only partial sections', () => {
    writeFileSync(join(TMP_DIR, 'config.yaml'), `
llm:
  base_url: https://partial.com/v1
`);

    loadCrowWireConfig(TMP_DIR);

    expect(process.env.LLM_BASE_URL).toBe('https://partial.com/v1');
    expect(process.env.LLM_API_KEY).toBeUndefined();
    expect(process.env.DISCORD_BOT_TOKEN).toBeUndefined();
  });

  it('maps all daemon settings to env vars', () => {
    writeFileSync(join(TMP_DIR, 'config.yaml'), `
daemon:
  fetch_interval: 10000
  urgent_flush_interval: 5000
  urgent_flush_count: 3
  digest_flush_interval: 600000
  urgency_threshold: 90
  similarity_threshold: 0.6
  dedup_ttl_hours: 48
  sent_event_ttl_hours: 12
  content_max_chars: 300
  max_items_per_run: 50
`);

    loadCrowWireConfig(TMP_DIR);

    expect(process.env.FETCH_INTERVAL).toBe('10000');
    expect(process.env.URGENT_FLUSH_INTERVAL).toBe('5000');
    expect(process.env.URGENT_FLUSH_COUNT).toBe('3');
    expect(process.env.DIGEST_FLUSH_INTERVAL).toBe('600000');
    expect(process.env.URGENCY_THRESHOLD).toBe('90');
    expect(process.env.SIMILARITY_THRESHOLD).toBe('0.6');
    expect(process.env.DEDUP_TTL_HOURS).toBe('48');
    expect(process.env.SENT_EVENT_TTL_HOURS).toBe('12');
    expect(process.env.CONTENT_MAX_CHARS).toBe('300');
    expect(process.env.MAX_ITEMS_PER_RUN).toBe('50');
  });
});
