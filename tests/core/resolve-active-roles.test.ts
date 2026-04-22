/**
 * Phase 11.a.3 regression for core/orchestrator.ts resolveActiveRoles.
 *
 * Locks the simple rule-set the user specified in Q3:
 *   - required roles are always active
 *   - optional roles are enabled by default when declared
 *   - opt-outs: --no-assets (artist/sound), --skip-critic (critic),
 *     assetBudgetUsd=0 (artist/sound)
 *   - no "shouldUseAgent(role, spec, recipe)" logic — simplicity first
 */
import { describe, expect, it } from 'vitest';
import { resolveActiveRoles } from '../../core/orchestrator.js';
import type { AgentRole, Recipe } from '../../core/types.js';

function recipeWith(agents?: { required: AgentRole[]; optional: AgentRole[] }): Recipe {
  const base: Recipe = {
    meta: { type: 'demo', version: '1.0.0', description: 'demo' },
    stack: { language: 'typescript', framework: 'none', deps: [] },
    scaffold: { type: 'template', path: '_template' },
    agentOverrides: {},
    build: { command: 'true', timeoutSec: 1 },
    test: { command: 'true', timeoutSec: 1 },
    evaluation: { criteria: [] },
  };
  return agents ? { ...base, agents } : base;
}

describe('resolveActiveRoles — backward compatible defaults', () => {
  it('recipe without `agents` falls back to the legacy 6 roles', () => {
    const roles = resolveActiveRoles(recipeWith());
    expect([...roles].sort()).toEqual([
      'architect',
      'director',
      'evaluator',
      'programmer',
      'reviewer',
      'tester',
    ]);
  });

  it('empty agents arrays still mean legacy 6 required', () => {
    const roles = resolveActiveRoles(recipeWith({ required: [], optional: [] }));
    expect(roles.has('director')).toBe(true);
    expect(roles.has('evaluator')).toBe(true);
    expect(roles.size).toBe(6);
  });
});

describe('resolveActiveRoles — optional roles enabled by default', () => {
  it('2d-game-style recipe activates artist/sound/critic on top of the 6 required', () => {
    const roles = resolveActiveRoles(
      recipeWith({
        required: ['director', 'architect', 'programmer', 'tester', 'reviewer', 'evaluator'],
        optional: ['artist', 'sound', 'critic'],
      }),
    );
    expect(roles.has('artist')).toBe(true);
    expect(roles.has('sound')).toBe(true);
    expect(roles.has('critic')).toBe(true);
    expect(roles.size).toBe(9);
  });

  it('web-app-style recipe activates writer/artist/critic', () => {
    const roles = resolveActiveRoles(
      recipeWith({
        required: ['director', 'architect', 'programmer', 'tester', 'reviewer', 'evaluator'],
        optional: ['writer', 'artist', 'critic'],
      }),
    );
    expect(roles.has('writer')).toBe(true);
    expect(roles.has('artist')).toBe(true);
    expect(roles.has('critic')).toBe(true);
    expect(roles.has('sound')).toBe(false);
  });

  it('cli-style recipe activates only writer', () => {
    const roles = resolveActiveRoles(
      recipeWith({
        required: ['director', 'architect', 'programmer', 'tester', 'reviewer', 'evaluator'],
        optional: ['writer'],
      }),
    );
    expect(roles.has('writer')).toBe(true);
    expect(roles.has('artist')).toBe(false);
    expect(roles.has('sound')).toBe(false);
    expect(roles.has('critic')).toBe(false);
  });
});

describe('resolveActiveRoles — opt-out flags', () => {
  const full = recipeWith({
    required: ['director', 'architect', 'programmer', 'tester', 'reviewer', 'evaluator'],
    optional: ['writer', 'artist', 'sound', 'critic'],
  });

  it('--no-assets drops artist + sound but keeps writer + critic', () => {
    const roles = resolveActiveRoles(full, { noAssets: true });
    expect(roles.has('artist')).toBe(false);
    expect(roles.has('sound')).toBe(false);
    expect(roles.has('writer')).toBe(true);
    expect(roles.has('critic')).toBe(true);
  });

  it('--skip-critic drops critic only', () => {
    const roles = resolveActiveRoles(full, { skipCritic: true });
    expect(roles.has('critic')).toBe(false);
    expect(roles.has('artist')).toBe(true);
    expect(roles.has('sound')).toBe(true);
    expect(roles.has('writer')).toBe(true);
  });

  it('assetBudgetUsd=0 drops artist + sound (same as --no-assets for that pair)', () => {
    const roles = resolveActiveRoles(full, { assetBudgetUsd: 0 });
    expect(roles.has('artist')).toBe(false);
    expect(roles.has('sound')).toBe(false);
    expect(roles.has('writer')).toBe(true);
    expect(roles.has('critic')).toBe(true);
  });

  it('assetBudgetUsd > 0 does NOT drop anything', () => {
    const roles = resolveActiveRoles(full, { assetBudgetUsd: 0.5 });
    expect(roles.has('artist')).toBe(true);
    expect(roles.has('sound')).toBe(true);
  });

  it('combining flags compounds: --no-assets + --skip-critic', () => {
    const roles = resolveActiveRoles(full, { noAssets: true, skipCritic: true });
    expect(roles.has('artist')).toBe(false);
    expect(roles.has('sound')).toBe(false);
    expect(roles.has('critic')).toBe(false);
    expect(roles.has('writer')).toBe(true);
  });
});

describe('resolveActiveRoles — no speculation', () => {
  // The user explicitly asked NOT to implement "shouldUseAgent" with
  // per-project-spec judgment. Instead, the flag set is the only policy.
  // This test guards against reintroducing heuristics.
  it('the function signature has no projectSpec arg (stays at `recipe` + optional flags)', () => {
    // Function.length counts only non-defaulted parameters. `flags` has a
    // default of `{}` so Fn.length = 1. If anyone adds a `spec` parameter
    // (which would reintroduce heuristics), the count bumps to 2 or 3 and
    // this test flags the drift.
    expect(resolveActiveRoles.length).toBe(1);
  });
});
