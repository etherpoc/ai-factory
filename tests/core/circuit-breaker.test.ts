import { describe, expect, it } from 'vitest';
import { createBreaker, resolveBreakerConfig } from '../../core/circuit-breaker';

describe('circuit-breaker', () => {
  it('trips after repeated-error threshold hits', () => {
    const b = createBreaker({ maxIterations: 100, repeatedErrorThreshold: 3 });
    b.tick('build failed: tsc --noEmit exited 1');
    b.tick('build failed: tsc --noEmit exited 1');
    expect(b.tripped()).toBe(false);
    b.tick('build failed: tsc --noEmit exited 1');
    expect(b.tripped()).toBe(true);
    expect(b.state.tripReason).toMatch(/repeated error/);
  });

  it('treats differently-numbered errors as the same signature', () => {
    const b = createBreaker({ maxIterations: 100, repeatedErrorThreshold: 2 });
    b.tick('ENOENT: no such file or directory, open ./workspace/a123');
    b.tick('ENOENT: no such file or directory, open ./workspace/b987');
    expect(b.tripped()).toBe(true);
  });

  it('resets the repeat counter when a new error appears', () => {
    const b = createBreaker({ maxIterations: 100, repeatedErrorThreshold: 3 });
    b.tick('error A');
    b.tick('error A');
    b.tick('error B');
    expect(b.tripped()).toBe(false);
    expect(b.state.repeatedErrorCount).toBe(1);
  });

  it('trips after reaching maxIterations even with no errors', () => {
    const b = createBreaker({ maxIterations: 2, repeatedErrorThreshold: 99 });
    b.tick();
    expect(b.tripped()).toBe(false);
    b.tick();
    expect(b.tripped()).toBe(true);
    expect(b.state.tripReason).toMatch(/max iterations/);
  });

  it('resolveBreakerConfig reads env overrides', () => {
    const cfg = resolveBreakerConfig({}, {
      UAF_MAX_ITERATIONS: '5',
      UAF_CIRCUIT_BREAKER_STRIKES: '7',
    } as NodeJS.ProcessEnv);
    expect(cfg).toEqual({ maxIterations: 5, repeatedErrorThreshold: 7 });
  });

  it('further ticks after trip are no-ops', () => {
    const b = createBreaker({ maxIterations: 1, repeatedErrorThreshold: 10 });
    b.tick();
    const beforeIter = b.state.iteration;
    b.tick('anything');
    expect(b.state.iteration).toBe(beforeIter);
  });
});
