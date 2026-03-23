import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parse } from 'yaml';
import type { DaemonConfig, TargetsConfig, PushTargetConfig, QueueType, PushTargetType, FiltersConfig } from '../types.js';

export function expandEnvVars(str: string): string {
  return str.replace(/\$\{([^}]+)\}/g, (_, name: string) => {
    const val = process.env[name];
    if (val === undefined) {
      throw new Error(`Environment variable "${name}" is not defined`);
    }
    return val;
  });
}

function expandEnvVarsInValue(val: unknown): unknown {
  if (typeof val === 'string') return expandEnvVars(val);
  if (Array.isArray(val)) return val.map(expandEnvVarsInValue);
  if (val !== null && typeof val === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      result[k] = expandEnvVarsInValue(v);
    }
    return result;
  }
  return val;
}

export function loadTargets(path: string): TargetsConfig {
  const raw = readFileSync(path, 'utf-8');
  const parsed = parse(raw) as Record<string, unknown>;

  if (!parsed || !Array.isArray(parsed.targets)) {
    throw new Error(`Invalid targets config: "targets" must be an array in ${path}`);
  }

  const expanded = expandEnvVarsInValue(parsed) as Record<string, unknown>;
  const rawTargets = expanded.targets as Record<string, unknown>[];

  const targets = rawTargets.map((t, i) => {
    if (!t.name || typeof t.name !== 'string') {
      throw new Error(`Target ${i}: "name" is required and must be a string`);
    }
    if (!t.type || typeof t.type !== 'string') {
      throw new Error(`Target ${i} (${t.name}): "type" is required and must be a string`);
    }
    if (!t.channel_id || typeof t.channel_id !== 'string') {
      throw new Error(`Target ${i} (${t.name}): "channel_id" is required and must be a string`);
    }
    if (!Array.isArray(t.queues) || t.queues.length === 0) {
      throw new Error(`Target ${i} (${t.name}): "queues" is required and must be a non-empty array`);
    }
    return {
      name: t.name,
      type: t.type as PushTargetType,
      channel_id: t.channel_id,
      queues: t.queues as QueueType[],
    } satisfies PushTargetConfig;
  });

  return { targets };
}

export function computeFileHash(filePath: string): string | null {
  try {
    const content = readFileSync(filePath, 'utf-8');
    return createHash('sha256').update(content).digest('hex');
  } catch {
    return null;
  }
}

export function loadFilters(path: string): FiltersConfig {
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = parse(raw) as Record<string, unknown>;
    const blacklist = Array.isArray(parsed?.blacklist)
      ? (parsed.blacklist as unknown[]).filter((x): x is string => typeof x === 'string')
      : [];
    return { blacklist };
  } catch {
    return { blacklist: [] };
  }
}

function envStr(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function envNum(key: string, fallback: number): number {
  const val = process.env[key];
  if (val === undefined) return fallback;
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

export function loadDaemonConfig(): DaemonConfig {
  return {
    fetch_interval:        envNum('FETCH_INTERVAL',         20000),
    urgent_flush_interval: envNum('URGENT_FLUSH_INTERVAL',  10000),
    urgent_flush_count:    envNum('URGENT_FLUSH_COUNT',     5),
    digest_flush_interval: envNum('DIGEST_FLUSH_INTERVAL',  900000),
    urgency_threshold:     envNum('URGENCY_THRESHOLD',      75),
    similarity_threshold:  envNum('SIMILARITY_THRESHOLD',   0.55),
    dedup_ttl_hours:       envNum('DEDUP_TTL_HOURS',        72),
    sent_event_ttl_hours:  envNum('SENT_EVENT_TTL_HOURS',   24),
    content_max_chars:     envNum('CONTENT_MAX_CHARS',      500),
    max_items_per_run:     envNum('MAX_ITEMS_PER_RUN',      30),
    db_path:               envStr('DB_PATH',               '/app/data/crowwire.db'),
    feeds_config:          envStr('FEEDS_CONFIG',          '/app/config/feeds.yaml'),
    targets_config:        envStr('TARGETS_CONFIG',        '/app/config/targets.yaml'),
    filters_config:        envStr('FILTERS_CONFIG',        '/app/config/filters.yaml'),
  };
}
