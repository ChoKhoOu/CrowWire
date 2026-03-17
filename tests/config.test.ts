import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../src/lib/config.js';

describe('loadConfig', () => {
  let dir: string;
  let configPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'crowwire-test-'));
    configPath = join(dir, 'feeds.yaml');
  });

  afterEach(() => {
    try { unlinkSync(configPath); } catch {}
  });

  it('loads a valid config with defaults', () => {
    writeFileSync(configPath, `
feeds:
  - name: test-feed
    url: https://example.com/rss
    enabled: true
`);
    const config = loadConfig(configPath);
    expect(config.feeds).toHaveLength(1);
    expect(config.feeds[0].name).toBe('test-feed');
    expect(config.feeds[0].url).toBe('https://example.com/rss');
    expect(config.feeds[0].enabled).toBe(true);
    expect(config.settings.urgent_threshold).toBe(75);
    expect(config.settings.digest_interval_minutes).toBe(15);
    expect(config.settings.dedup_ttl_hours).toBe(72);
    expect(config.settings.content_max_chars).toBe(500);
    expect(config.settings.max_items_per_run).toBe(20);
  });

  it('loads custom settings', () => {
    writeFileSync(configPath, `
feeds:
  - name: f1
    url: https://example.com/rss
settings:
  urgent_threshold: 90
  digest_interval_minutes: 30
  dedup_ttl_hours: 48
  content_max_chars: 1000
  max_items_per_run: 10
`);
    const config = loadConfig(configPath);
    expect(config.settings.urgent_threshold).toBe(90);
    expect(config.settings.digest_interval_minutes).toBe(30);
    expect(config.settings.dedup_ttl_hours).toBe(48);
    expect(config.settings.content_max_chars).toBe(1000);
    expect(config.settings.max_items_per_run).toBe(10);
  });

  it('defaults enabled to true when omitted', () => {
    writeFileSync(configPath, `
feeds:
  - name: f1
    url: https://example.com/rss
`);
    const config = loadConfig(configPath);
    expect(config.feeds[0].enabled).toBe(true);
  });

  it('throws on missing feeds array', () => {
    writeFileSync(configPath, 'settings:\n  urgent_threshold: 85\n');
    expect(() => loadConfig(configPath)).toThrow('feeds');
  });

  it('throws on missing feed name', () => {
    writeFileSync(configPath, `
feeds:
  - url: https://example.com/rss
`);
    expect(() => loadConfig(configPath)).toThrow('name');
  });

  it('throws on missing feed url', () => {
    writeFileSync(configPath, `
feeds:
  - name: test
`);
    expect(() => loadConfig(configPath)).toThrow('url');
  });
});
