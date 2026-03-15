import { describe, it, expect } from 'vitest';
import { canonicalizeUrl } from '../../pipeline/normalizer/url-canonicalizer.js';

describe('canonicalizeUrl', () => {
  it('strips utm parameters', () => {
    const result = canonicalizeUrl('https://example.com/article?utm_source=twitter&utm_medium=social&id=123');
    expect(result).toContain('id=123');
    expect(result).not.toContain('utm_source');
    expect(result).not.toContain('utm_medium');
  });

  it('strips fbclid and gclid', () => {
    const result = canonicalizeUrl('https://example.com/page?fbclid=abc&gclid=xyz');
    expect(result).toBe('https://example.com/page');
  });

  it('removes trailing slash', () => {
    const result = canonicalizeUrl('https://example.com/page/');
    expect(result).toBe('https://example.com/page');
  });

  it('keeps root slash', () => {
    const result = canonicalizeUrl('https://example.com/');
    expect(result).toBe('https://example.com/');
  });

  it('lowercases hostname', () => {
    const result = canonicalizeUrl('https://EXAMPLE.COM/Article');
    expect(result).toContain('example.com');
    expect(result).toContain('/Article'); // Path case preserved
  });

  it('sorts query params', () => {
    const result = canonicalizeUrl('https://example.com/page?z=1&a=2');
    expect(result).toBe('https://example.com/page?a=2&z=1');
  });

  it('removes fragment', () => {
    const result = canonicalizeUrl('https://example.com/page#section');
    expect(result).toBe('https://example.com/page');
  });

  it('returns invalid URL as-is', () => {
    const result = canonicalizeUrl('not-a-url');
    expect(result).toBe('not-a-url');
  });
});
