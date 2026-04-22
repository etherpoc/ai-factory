import type { CircuitBreakerConfig, CircuitBreakerState } from './types.js';

export const DEFAULT_BREAKER: CircuitBreakerConfig = {
  maxIterations: 8,
  repeatedErrorThreshold: 3,
};

export function resolveBreakerConfig(
  override: Partial<CircuitBreakerConfig> = {},
  env = process.env,
): CircuitBreakerConfig {
  const maxIterations =
    override.maxIterations ??
    parsePositiveInt(env.UAF_MAX_ITERATIONS) ??
    DEFAULT_BREAKER.maxIterations;
  const repeatedErrorThreshold =
    override.repeatedErrorThreshold ??
    parsePositiveInt(env.UAF_CIRCUIT_BREAKER_STRIKES) ??
    DEFAULT_BREAKER.repeatedErrorThreshold;
  return { maxIterations, repeatedErrorThreshold };
}

export interface CircuitBreaker {
  readonly state: Readonly<CircuitBreakerState>;
  /**
   * Advance one iteration. If `error` is provided and its signature matches
   * the previous one, the repeated-error counter increments.
   */
  tick(error?: string): CircuitBreakerState;
  /** True once the breaker has tripped — subsequent tick() calls are no-ops. */
  tripped(): boolean;
  reset(): void;
}

export function createBreaker(config: CircuitBreakerConfig): CircuitBreaker {
  const state: CircuitBreakerState = {
    iteration: 0,
    repeatedErrorCount: 0,
    tripped: false,
  };

  return {
    get state() {
      return state;
    },
    tick(error?: string) {
      if (state.tripped) return state;

      state.iteration += 1;

      if (error !== undefined) {
        const sig = signature(error);
        if (state.lastErrorSignature === sig) {
          state.repeatedErrorCount += 1;
        } else {
          state.lastErrorSignature = sig;
          state.repeatedErrorCount = 1;
        }
        if (state.repeatedErrorCount >= config.repeatedErrorThreshold) {
          state.tripped = true;
          state.tripReason = `repeated error ×${state.repeatedErrorCount}: ${truncate(error, 160)}`;
          return state;
        }
      } else {
        state.lastErrorSignature = undefined;
        state.repeatedErrorCount = 0;
      }

      if (state.iteration >= config.maxIterations) {
        state.tripped = true;
        state.tripReason = `max iterations reached (${config.maxIterations})`;
      }

      return state;
    },
    tripped() {
      return state.tripped;
    },
    reset() {
      state.iteration = 0;
      state.repeatedErrorCount = 0;
      state.tripped = false;
      delete state.lastErrorSignature;
      delete state.tripReason;
    },
  };
}

/** Normalize an error message down to a stable signature for equality checks. */
function signature(msg: string): string {
  return msg
    .replace(/\s+/g, ' ')
    .replace(/[A-Za-z]:\\[\S]+|\/[\S]+/g, '<path>')
    .replace(/0x[0-9a-fA-F]+|\d+/g, '<n>')
    .trim()
    .slice(0, 200);
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

function parsePositiveInt(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
