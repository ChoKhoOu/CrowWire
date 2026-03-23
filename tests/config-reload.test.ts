import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { computeFileHash, loadFilters, loadTargets, loadDaemonConfig } from '../src/lib/target-config.js';
import { loadConfig } from '../src/lib/config.js';

describe('config reload detection', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'crowwire-reload-test-'));
  });

  it('detects hash change when file content changes', () => {
    const path = join(dir, 'config.yaml');
    writeFileSync(path, 'version: 1\n');
    const hash1 = computeFileHash(path);

    writeFileSync(path, 'version: 2\n');
    const hash2 = computeFileHash(path);

    expect(hash1).not.toBe(hash2);
    unlinkSync(path);
  });

  it('returns same hash when file content unchanged', () => {
    const path = join(dir, 'config.yaml');
    writeFileSync(path, 'stable: true\n');
    const hash1 = computeFileHash(path);
    const hash2 = computeFileHash(path);

    expect(hash1).toBe(hash2);
    unlinkSync(path);
  });

  it('preserves previous config on failed reload (invalid YAML feeds)', () => {
    const path = join(dir, 'feeds.yaml');
    writeFileSync(path, `
feeds:
  - name: test-feed
    url: https://example.com/rss
    enabled: true
`);
    const goodConfig = loadConfig(path);
    expect(goodConfig.feeds).toHaveLength(1);

    // Write invalid content
    writeFileSync(path, 'not:\n  valid: feeds config\n');
    expect(() => loadConfig(path)).toThrow('feeds');

    // Good config is still the one we loaded before
    expect(goodConfig.feeds).toHaveLength(1);
    expect(goodConfig.feeds[0].name).toBe('test-feed');
    unlinkSync(path);
  });

  it('preserves previous config on failed reload (invalid targets)', () => {
    const path = join(dir, 'targets.yaml');
    process.env['TEST_CHAN'] = '12345';
    writeFileSync(path, `
targets:
  - name: test
    type: discord
    channel_id: "\${TEST_CHAN}"
    queues: [urgent]
`);
    const goodConfig = loadTargets(path);
    expect(goodConfig.targets).toHaveLength(1);

    writeFileSync(path, 'not:\n  valid: targets\n');
    expect(() => loadTargets(path)).toThrow('targets');

    expect(goodConfig.targets).toHaveLength(1);
    delete process.env['TEST_CHAN'];
    unlinkSync(path);
  });

  it('filters reload updates blacklist categories', () => {
    const path = join(dir, 'filters.yaml');
    writeFileSync(path, 'blacklist:\n  - "rule A"\n');
    const cfg1 = loadFilters(path);
    expect(cfg1.blacklist).toEqual(['rule A']);

    writeFileSync(path, 'blacklist:\n  - "rule A"\n  - "rule B"\n');
    const cfg2 = loadFilters(path);
    expect(cfg2.blacklist).toEqual(['rule A', 'rule B']);
    unlinkSync(path);
  });

  it('missing filters.yaml returns empty blacklist', () => {
    const cfg = loadFilters(join(dir, 'does-not-exist.yaml'));
    expect(cfg.blacklist).toEqual([]);
  });

  it('hash returns null for missing file then non-null after creation', () => {
    const path = join(dir, 'late-create.yaml');
    expect(computeFileHash(path)).toBeNull();

    writeFileSync(path, 'blacklist: []\n');
    expect(computeFileHash(path)).not.toBeNull();
    unlinkSync(path);
  });
});

describe('loadDaemonConfig with FILTERS_CONFIG', () => {
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

  it('returns default filters_config path', () => {
    const cfg = loadDaemonConfig();
    expect(cfg.filters_config).toBe('/app/config/filters.yaml');
  });

  it('overrides filters_config from env var', () => {
    process.env['FILTERS_CONFIG'] = '/custom/filters.yaml';
    const cfg = loadDaemonConfig();
    expect(cfg.filters_config).toBe('/custom/filters.yaml');
  });
});
