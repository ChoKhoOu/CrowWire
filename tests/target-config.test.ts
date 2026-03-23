import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expandEnvVars, loadTargets, loadDaemonConfig } from '../src/lib/target-config.js';

describe('expandEnvVars', () => {
  it('substitutes a defined env var', () => {
    process.env['TEST_VAR_XYZ'] = 'hello';
    expect(expandEnvVars('prefix_${TEST_VAR_XYZ}_suffix')).toBe('prefix_hello_suffix');
    delete process.env['TEST_VAR_XYZ'];
  });

  it('substitutes multiple env vars in one string', () => {
    process.env['A_VAR'] = 'foo';
    process.env['B_VAR'] = 'bar';
    expect(expandEnvVars('${A_VAR}-${B_VAR}')).toBe('foo-bar');
    delete process.env['A_VAR'];
    delete process.env['B_VAR'];
  });

  it('throws when env var is undefined', () => {
    delete process.env['MISSING_VAR_XYZ'];
    expect(() => expandEnvVars('${MISSING_VAR_XYZ}')).toThrow('MISSING_VAR_XYZ');
  });

  it('returns string unchanged when no placeholders', () => {
    expect(expandEnvVars('no-placeholders')).toBe('no-placeholders');
  });
});

describe('loadDaemonConfig', () => {
  const envKeys = [
    'FETCH_INTERVAL', 'URGENT_FLUSH_INTERVAL', 'URGENT_FLUSH_COUNT',
    'DIGEST_FLUSH_INTERVAL', 'URGENCY_THRESHOLD', 'SIMILARITY_THRESHOLD',
    'DEDUP_TTL_HOURS', 'SENT_EVENT_TTL_HOURS', 'CONTENT_MAX_CHARS',
    'MAX_ITEMS_PER_RUN', 'DB_PATH', 'FEEDS_CONFIG', 'TARGETS_CONFIG',
    'FILTERS_CONFIG',
  ];

  let saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    saved = {};
    for (const key of envKeys) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  });

  it('returns all defaults when no env vars are set', () => {
    const cfg = loadDaemonConfig();
    expect(cfg.fetch_interval).toBe(20000);
    expect(cfg.urgent_flush_interval).toBe(10000);
    expect(cfg.urgent_flush_count).toBe(5);
    expect(cfg.digest_flush_interval).toBe(900000);
    expect(cfg.urgency_threshold).toBe(75);
    expect(cfg.similarity_threshold).toBe(0.55);
    expect(cfg.dedup_ttl_hours).toBe(72);
    expect(cfg.sent_event_ttl_hours).toBe(24);
    expect(cfg.content_max_chars).toBe(500);
    expect(cfg.max_items_per_run).toBe(30);
    expect(cfg.db_path).toBe('/app/data/crowwire.db');
    expect(cfg.feeds_config).toBe('/app/feeds.yaml');
    expect(cfg.targets_config).toBe('/app/targets.yaml');
    expect(cfg.filters_config).toBe('/app/filters.yaml');
  });

  it('overrides numeric values from env vars', () => {
    process.env['FETCH_INTERVAL'] = '5000';
    process.env['URGENT_FLUSH_COUNT'] = '10';
    process.env['URGENCY_THRESHOLD'] = '80';
    process.env['SIMILARITY_THRESHOLD'] = '0.7';
    const cfg = loadDaemonConfig();
    expect(cfg.fetch_interval).toBe(5000);
    expect(cfg.urgent_flush_count).toBe(10);
    expect(cfg.urgency_threshold).toBe(80);
    expect(cfg.similarity_threshold).toBe(0.7);
  });

  it('overrides string path values from env vars', () => {
    process.env['DB_PATH'] = '/data/my.db';
    process.env['FEEDS_CONFIG'] = '/etc/feeds.yaml';
    process.env['TARGETS_CONFIG'] = '/etc/targets.yaml';
    const cfg = loadDaemonConfig();
    expect(cfg.db_path).toBe('/data/my.db');
    expect(cfg.feeds_config).toBe('/etc/feeds.yaml');
    expect(cfg.targets_config).toBe('/etc/targets.yaml');
  });
});

describe('loadTargets', () => {
  let dir: string;
  let configPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'crowwire-targets-test-'));
    configPath = join(dir, 'targets.yaml');
    process.env['DISCORD_URGENT_CHANNEL_ID'] = '111222333';
    process.env['DISCORD_DIGEST_CHANNEL_ID'] = '444555666';
  });

  afterEach(() => {
    try { unlinkSync(configPath); } catch {}
    delete process.env['DISCORD_URGENT_CHANNEL_ID'];
    delete process.env['DISCORD_DIGEST_CHANNEL_ID'];
  });

  it('loads valid YAML and expands env vars in channel_id', () => {
    writeFileSync(configPath, `
targets:
  - name: alerts
    type: discord
    channel_id: "\${DISCORD_URGENT_CHANNEL_ID}"
    queues: [urgent]
  - name: digest
    type: discord
    channel_id: "\${DISCORD_DIGEST_CHANNEL_ID}"
    queues: [normal]
`);
    const cfg = loadTargets(configPath);
    expect(cfg.targets).toHaveLength(2);
    expect(cfg.targets[0].name).toBe('alerts');
    expect(cfg.targets[0].type).toBe('discord');
    expect(cfg.targets[0].channel_id).toBe('111222333');
    expect(cfg.targets[0].queues).toEqual(['urgent']);
    expect(cfg.targets[1].name).toBe('digest');
    expect(cfg.targets[1].channel_id).toBe('444555666');
    expect(cfg.targets[1].queues).toEqual(['normal']);
  });

  it('throws when an env var referenced in channel_id is undefined', () => {
    delete process.env['DISCORD_URGENT_CHANNEL_ID'];
    writeFileSync(configPath, `
targets:
  - name: alerts
    type: discord
    channel_id: "\${DISCORD_URGENT_CHANNEL_ID}"
    queues: [urgent]
`);
    expect(() => loadTargets(configPath)).toThrow('DISCORD_URGENT_CHANNEL_ID');
  });

  it('throws when targets array is missing', () => {
    writeFileSync(configPath, 'settings:\n  foo: bar\n');
    expect(() => loadTargets(configPath)).toThrow('targets');
  });

  it('throws when a target is missing name', () => {
    writeFileSync(configPath, `
targets:
  - type: discord
    channel_id: "123"
    queues: [urgent]
`);
    expect(() => loadTargets(configPath)).toThrow('name');
  });

  it('throws when a target is missing channel_id', () => {
    writeFileSync(configPath, `
targets:
  - name: alerts
    type: discord
    queues: [urgent]
`);
    expect(() => loadTargets(configPath)).toThrow('channel_id');
  });

  it('throws when a target is missing queues', () => {
    writeFileSync(configPath, `
targets:
  - name: alerts
    type: discord
    channel_id: "123"
`);
    expect(() => loadTargets(configPath)).toThrow('queues');
  });
});
