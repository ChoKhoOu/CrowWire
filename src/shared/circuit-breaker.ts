import { createChildLogger } from './logger.js';
import { DEFAULTS } from '../config/constants.js';
import { circuitBreakerState } from './metrics.js';

const log = createChildLogger({ module: 'circuit-breaker' });

export class CircuitBreaker {
  private successes = 0;
  private failures = 0;
  private state: 'closed' | 'open' = 'closed';
  private openedAt: number = 0;
  private windowStart: number = Date.now();
  private readonly windowMs: number;
  private readonly threshold: number;
  private readonly pauseMs: number;

  constructor(opts?: { windowMs?: number; threshold?: number; pauseMs?: number }) {
    this.windowMs = opts?.windowMs ?? DEFAULTS.CIRCUIT_BREAKER_WINDOW_MS;
    this.threshold = opts?.threshold ?? DEFAULTS.CIRCUIT_BREAKER_THRESHOLD;
    this.pauseMs = opts?.pauseMs ?? DEFAULTS.CIRCUIT_BREAKER_PAUSE_MS;
  }

  recordSuccess(): void {
    this.maybeResetWindow();
    this.successes++;
  }

  recordFailure(): void {
    this.maybeResetWindow();
    this.failures++;
    this.checkThreshold();
  }

  isOpen(): boolean {
    if (this.state === 'closed') return false;
    // Auto-close after pause period
    if (Date.now() - this.openedAt >= this.pauseMs) {
      this.state = 'closed';
      this.resetCounters();
      circuitBreakerState.set({ service: 'model_api' }, 0);
      log.info('Circuit breaker closed (pause period elapsed)');
      return false;
    }
    return true;
  }

  getState(): 'closed' | 'open' {
    this.isOpen(); // May transition state
    return this.state;
  }

  private maybeResetWindow(): void {
    if (Date.now() - this.windowStart >= this.windowMs) {
      this.resetCounters();
    }
  }

  private resetCounters(): void {
    this.successes = 0;
    this.failures = 0;
    this.windowStart = Date.now();
  }

  private checkThreshold(): void {
    const total = this.successes + this.failures;
    if (total < 5) return; // Need minimum samples
    const errorRate = this.failures / total;
    if (errorRate > this.threshold) {
      this.state = 'open';
      this.openedAt = Date.now();
      circuitBreakerState.set({ service: 'model_api' }, 1);
      log.warn({ errorRate, failures: this.failures, total }, 'Circuit breaker opened');
    }
  }
}

// Singleton for model API circuit breaker
export const modelCircuitBreaker = new CircuitBreaker();
