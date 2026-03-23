import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { computeFileHash, loadFilters } from '../src/lib/target-config.js';

describe('computeFileHash', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'crowwire-hash-test-'));
  });

  it('returns consistent hash for same content', () => {
    const path = join(dir, 'test.txt');
    writeFileSync(path, 'hello world');
    const hash1 = computeFileHash(path);
    const hash2 = computeFileHash(path);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    unlinkSync(path);
  });

  it('returns different hash for different content', () => {
    const path1 = join(dir, 'a.txt');
    const path2 = join(dir, 'b.txt');
    writeFileSync(path1, 'content A');
    writeFileSync(path2, 'content B');
    const hash1 = computeFileHash(path1);
    const hash2 = computeFileHash(path2);
    expect(hash1).not.toBe(hash2);
    unlinkSync(path1);
    unlinkSync(path2);
  });

  it('returns null for non-existent file', () => {
    const hash = computeFileHash(join(dir, 'no-such-file.txt'));
    expect(hash).toBeNull();
  });
});

describe('loadFilters', () => {
  let dir: string;
  let filtersPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'crowwire-filters-test-'));
    filtersPath = join(dir, 'filters.yaml');
  });

  afterEach(() => {
    try { unlinkSync(filtersPath); } catch {}
  });

  it('returns empty blacklist when file does not exist', () => {
    const cfg = loadFilters(join(dir, 'nonexistent.yaml'));
    expect(cfg.blacklist).toEqual([]);
  });

  it('returns empty blacklist when file has no blacklist key', () => {
    writeFileSync(filtersPath, 'settings:\n  foo: bar\n');
    const cfg = loadFilters(filtersPath);
    expect(cfg.blacklist).toEqual([]);
  });

  it('parses valid blacklist array', () => {
    writeFileSync(filtersPath, `
blacklist:
  - "大A个股涨跌、股价、涨停板相关新闻"
  - "加密货币币价波动"
`);
    const cfg = loadFilters(filtersPath);
    expect(cfg.blacklist).toEqual([
      '大A个股涨跌、股价、涨停板相关新闻',
      '加密货币币价波动',
    ]);
  });

  it('filters out non-string entries from blacklist array', () => {
    writeFileSync(filtersPath, `
blacklist:
  - "valid entry"
  - 42
  - true
  - "another valid"
`);
    const cfg = loadFilters(filtersPath);
    expect(cfg.blacklist).toEqual(['valid entry', 'another valid']);
  });

  it('returns empty blacklist when blacklist is not an array', () => {
    writeFileSync(filtersPath, 'blacklist: "not an array"\n');
    const cfg = loadFilters(filtersPath);
    expect(cfg.blacklist).toEqual([]);
  });

  it('returns empty blacklist when all entries are commented out', () => {
    writeFileSync(filtersPath, `
blacklist:
  # - "commented out"
  # - "also commented"
`);
    const cfg = loadFilters(filtersPath);
    expect(cfg.blacklist).toEqual([]);
  });
});
