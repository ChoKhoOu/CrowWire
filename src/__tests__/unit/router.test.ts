import { describe, it, expect } from 'vitest';

describe('routing logic', () => {
  const THRESHOLD = 85;
  function route(urgencyScore: number): 'urgent' | 'batch' {
    return urgencyScore >= THRESHOLD ? 'urgent' : 'batch';
  }

  it('routes urgent at threshold', () => expect(route(85)).toBe('urgent'));
  it('routes urgent above threshold', () => expect(route(90)).toBe('urgent'));
  it('routes batch below threshold', () => expect(route(84)).toBe('batch'));
  it('routes batch at zero', () => expect(route(0)).toBe('batch'));
  it('routes urgent at max', () => expect(route(100)).toBe('urgent'));
});
