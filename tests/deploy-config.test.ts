import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readDeployConfig,
  writeDeployConfig,
  defaultDeployConfig,
  toLobsterArgsJson,
  getDeployConfigPath,
} from '../src/lib/deploy-config.js';

describe('deploy-config', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'crowwire-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true });
  });

  it('returns null when no config exists', () => {
    expect(readDeployConfig(dir)).toBeNull();
  });

  it('writes and reads config round-trip', () => {
    const cfg = defaultDeployConfig(dir);
    cfg.channel = 'telegram';
    cfg.target = 'chat:789';
    writeDeployConfig(dir, cfg);

    const read = readDeployConfig(dir);
    expect(read).toEqual(cfg);
  });

  it('preserves channel/target across update (path-only sync)', () => {
    // First install: user configures their target
    const cfg = defaultDeployConfig(dir);
    cfg.channel = 'discord';
    cfg.target = 'channel:REAL_ID_123';
    writeDeployConfig(dir, cfg);

    // Simulate update: read existing, update paths only, leave channel/target
    const existing = readDeployConfig(dir)!;
    expect(existing.target).toBe('channel:REAL_ID_123');

    existing.config = '/new/install/path/feeds.yaml';
    existing.db = '/new/install/path/crowwire.db';
    writeDeployConfig(dir, existing);

    const final = readDeployConfig(dir)!;
    expect(final.channel).toBe('discord');
    expect(final.target).toBe('channel:REAL_ID_123');
    expect(final.config).toBe('/new/install/path/feeds.yaml');
    expect(final.db).toBe('/new/install/path/crowwire.db');
  });

  it('generates correct lobster args JSON (only pipeline fields)', () => {
    const cfg = defaultDeployConfig(dir);
    cfg.channel = 'slack';
    cfg.target = 'channel:abc';

    const json = toLobsterArgsJson(cfg);
    const parsed = JSON.parse(json);

    expect(parsed.channel).toBe('slack');
    expect(parsed.target).toBe('channel:abc');
    expect(parsed.config).toBe(cfg.config);
    expect(parsed.db).toBe(cfg.db);
    // cron/tz must NOT leak into lobster args
    expect(parsed.cron).toBeUndefined();
    expect(parsed.tz).toBeUndefined();
  });

  it('config file is written to expected path', () => {
    const cfg = defaultDeployConfig(dir);
    writeDeployConfig(dir, cfg);

    const expectedPath = getDeployConfigPath(dir);
    const raw = readFileSync(expectedPath, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.channel).toBe('discord');
  });

  it('default config has all required fields', () => {
    const cfg = defaultDeployConfig('/opt/CrowWire');
    expect(cfg.channel).toBe('discord');
    expect(cfg.target).toBe('channel:YOUR_CHANNEL_ID');
    expect(cfg.config).toBe('/opt/CrowWire/feeds.yaml');
    expect(cfg.db).toBe('/opt/CrowWire/crowwire.db');
    expect(cfg.cron).toBe('*/2 * * * *');
    expect(cfg.tz).toBe('Asia/Shanghai');
  });
});
