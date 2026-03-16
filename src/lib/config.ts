import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import type { FeedsConfig } from '../types.js';

const DEFAULTS = {
  urgent_threshold: 85,
  digest_interval_minutes: 15,
  dedup_ttl_hours: 72,
  content_max_chars: 500,
  max_items_per_run: 20,
  similarity_threshold: 0.55,
  sent_event_ttl_hours: 24,
};

export function loadConfig(configPath: string): FeedsConfig {
  const raw = readFileSync(configPath, 'utf-8');
  const parsed = parse(raw) as Record<string, unknown>;

  if (!parsed || !Array.isArray(parsed.feeds)) {
    throw new Error(`Invalid config: "feeds" must be an array in ${configPath}`);
  }

  const feeds = (parsed.feeds as Record<string, unknown>[]).map((f, i) => {
    if (!f.name || typeof f.name !== 'string') {
      throw new Error(`Feed ${i}: "name" is required and must be a string`);
    }
    if (!f.url || typeof f.url !== 'string') {
      throw new Error(`Feed ${i} (${f.name}): "url" is required and must be a string`);
    }
    return {
      name: f.name,
      url: f.url,
      enabled: f.enabled !== false,
    };
  });

  const s = (parsed.settings ?? {}) as Record<string, unknown>;

  return {
    feeds,
    settings: {
      urgent_threshold: num(s.urgent_threshold, DEFAULTS.urgent_threshold),
      digest_interval_minutes: num(s.digest_interval_minutes, DEFAULTS.digest_interval_minutes),
      dedup_ttl_hours: num(s.dedup_ttl_hours, DEFAULTS.dedup_ttl_hours),
      content_max_chars: num(s.content_max_chars, DEFAULTS.content_max_chars),
      max_items_per_run: num(s.max_items_per_run, DEFAULTS.max_items_per_run),
      similarity_threshold: num(s.similarity_threshold, DEFAULTS.similarity_threshold),
      sent_event_ttl_hours: num(s.sent_event_ttl_hours, DEFAULTS.sent_event_ttl_hours),
    },
  };
}

function num(val: unknown, fallback: number): number {
  return typeof val === 'number' && Number.isFinite(val) ? val : fallback;
}
