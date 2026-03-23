// Loads config.yaml and populates process.env
// Existing env vars take priority (allows Docker/CI overrides)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

interface CrowWireYamlConfig {
  llm?: {
    base_url?: string;
    api_key?: string;
    model?: string;
  };
  discord?: {
    bot_token?: string;
  };
  daemon?: Record<string, unknown>;
}

const DAEMON_KEY_TO_ENV: Record<string, string> = {
  fetch_interval: 'FETCH_INTERVAL',
  urgent_flush_interval: 'URGENT_FLUSH_INTERVAL',
  urgent_flush_count: 'URGENT_FLUSH_COUNT',
  digest_flush_interval: 'DIGEST_FLUSH_INTERVAL',
  urgency_threshold: 'URGENCY_THRESHOLD',
  similarity_threshold: 'SIMILARITY_THRESHOLD',
  dedup_ttl_hours: 'DEDUP_TTL_HOURS',
  sent_event_ttl_hours: 'SENT_EVENT_TTL_HOURS',
  content_max_chars: 'CONTENT_MAX_CHARS',
  max_items_per_run: 'MAX_ITEMS_PER_RUN',
};

/**
 * Load config.yaml from configDir and populate process.env.
 * Existing env vars are NOT overwritten (allows Docker/CI overrides).
 * If config.yaml is missing, silently falls back to env vars only.
 */
export function loadCrowWireConfig(configDir: string): void {
  const configPath = join(configDir, 'config.yaml');
  let raw: string;
  try {
    raw = readFileSync(configPath, 'utf-8');
  } catch {
    // config.yaml not found — rely on env vars (backward compat with .env)
    return;
  }

  const config = parse(raw) as CrowWireYamlConfig | null;
  if (!config) return;

  const envMap: Record<string, string | undefined> = {
    LLM_BASE_URL: config.llm?.base_url,
    LLM_API_KEY: config.llm?.api_key,
    LLM_MODEL: config.llm?.model,
    DISCORD_BOT_TOKEN: config.discord?.bot_token,
  };

  // Map daemon settings
  if (config.daemon) {
    for (const [key, envKey] of Object.entries(DAEMON_KEY_TO_ENV)) {
      if (config.daemon[key] !== undefined) {
        envMap[envKey] = String(config.daemon[key]);
      }
    }
  }

  // Set config file paths to configDir (if not already set)
  envMap.FEEDS_CONFIG = join(configDir, 'feeds.yaml');
  envMap.TARGETS_CONFIG = join(configDir, 'targets.yaml');
  envMap.FILTERS_CONFIG = join(configDir, 'filters.yaml');

  // Populate env — existing values take priority
  for (const [key, value] of Object.entries(envMap)) {
    if (value !== undefined && !process.env[key]) {
      process.env[key] = value;
    }
  }
}
