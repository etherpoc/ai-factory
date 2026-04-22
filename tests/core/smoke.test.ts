import { describe, expect, it } from 'vitest';
import type { AgentRole, CircuitBreakerConfig, Recipe } from '../../core/types';

describe('Phase 0 smoke', () => {
  it('core/types exports are type-checkable', () => {
    // Structural use of the imported types at value level to ensure the module resolves.
    const role: AgentRole = 'director';
    const breaker: CircuitBreakerConfig = {
      maxIterations: 8,
      repeatedErrorThreshold: 3,
    };
    expect(role).toBe('director');
    expect(breaker.maxIterations).toBeGreaterThan(0);
  });

  it('Recipe type narrows scaffold correctly', () => {
    const recipe: Recipe = {
      meta: { type: 'smoke', version: '0.0.0', description: '' },
      stack: { language: 'typescript', framework: 'none', deps: [] },
      scaffold: { type: 'template', path: '_template' },
      agentOverrides: {},
      build: { command: 'echo build', timeoutSec: 1 },
      test: { command: 'echo test', timeoutSec: 1 },
      evaluation: { criteria: [] },
    };
    expect(recipe.scaffold.type).toBe('template');
  });
});
