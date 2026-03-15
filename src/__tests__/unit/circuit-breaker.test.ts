import { describe, it, expect } from 'vitest';
import { CircuitBreaker } from '../../shared/circuit-breaker.js';

describe('CircuitBreaker', () => {
  it('starts in closed state', () => {
    const cb = new CircuitBreaker();
    expect(cb.getState()).toBe('closed');
    expect(cb.isOpen()).toBe(false);
  });

  it('stays closed with low error rate', () => {
    const cb = new CircuitBreaker({ windowMs: 60000, threshold: 0.5 });
    for (let i = 0; i < 8; i++) cb.recordSuccess();
    for (let i = 0; i < 2; i++) cb.recordFailure();
    expect(cb.getState()).toBe('closed'); // 20% error rate < 50% threshold
  });

  it('opens when error rate exceeds threshold', () => {
    const cb = new CircuitBreaker({ windowMs: 60000, threshold: 0.5 });
    for (let i = 0; i < 2; i++) cb.recordSuccess();
    for (let i = 0; i < 4; i++) cb.recordFailure();
    expect(cb.getState()).toBe('open'); // 67% error rate > 50% threshold
  });

  it('requires minimum samples before opening', () => {
    const cb = new CircuitBreaker({ windowMs: 60000, threshold: 0.5 });
    for (let i = 0; i < 3; i++) cb.recordFailure();
    expect(cb.getState()).toBe('closed'); // Only 3 samples, need >= 5
  });

  it('auto-closes after pause period', () => {
    const cb = new CircuitBreaker({ windowMs: 60000, threshold: 0.5, pauseMs: 10 });
    for (let i = 0; i < 2; i++) cb.recordSuccess();
    for (let i = 0; i < 4; i++) cb.recordFailure();
    expect(cb.getState()).toBe('open');

    // Wait for pause period
    return new Promise<void>(resolve => {
      setTimeout(() => {
        expect(cb.getState()).toBe('closed');
        resolve();
      }, 20);
    });
  });

  it('reports isOpen correctly', () => {
    const cb = new CircuitBreaker({ windowMs: 60000, threshold: 0.5 });
    expect(cb.isOpen()).toBe(false);
    for (let i = 0; i < 2; i++) cb.recordSuccess();
    for (let i = 0; i < 4; i++) cb.recordFailure();
    expect(cb.isOpen()).toBe(true);
  });
});
