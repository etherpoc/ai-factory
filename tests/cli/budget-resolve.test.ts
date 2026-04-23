/**
 * Phase 7.8.11 — budget resolution priority tests.
 *
 * Priority: CLI flag > env > recipe.defaults > user-config > built-in.
 */
import { describe, expect, it } from 'vitest';
import {
  describeBudget,
  resolveAssetBudgetUsd,
  resolveBudgetUsd,
} from '../../cli/utils/budget-resolve';
import type { UafConfig } from '../../cli/config/schema';
import type { Recipe } from '../../core/types';

const emptyConfig: UafConfig = {};
const recipeWithDefaults = (budgetUsd?: number, assetBudgetUsd?: number): Recipe =>
  ({
    meta: { type: '2d-game', version: '1.0.0', description: 'demo' },
    stack: { language: 'ts', framework: 'phaser3', deps: [] },
    scaffold: { type: 'template', path: 'template' },
    agentOverrides: {},
    build: { command: 'true', timeoutSec: 10 },
    test: { command: 'true', timeoutSec: 10 },
    evaluation: { criteria: [] },
    ...(budgetUsd !== undefined || assetBudgetUsd !== undefined
      ? {
          defaults: {
            ...(budgetUsd !== undefined ? { budgetUsd } : {}),
            ...(assetBudgetUsd !== undefined ? { assetBudgetUsd } : {}),
          },
        }
      : {}),
  }) as Recipe;

describe('resolveBudgetUsd', () => {
  it('CLI flag wins over every other source', () => {
    const r = resolveBudgetUsd({
      cliFlag: '1.00',
      recipe: recipeWithDefaults(3.5),
      config: { budget_usd: 2.0 },
    });
    expect(r).toEqual({ usd: 1, source: 'cli-flag' });
  });

  it('recipe.defaults beats user-config and built-in', () => {
    const r = resolveBudgetUsd({
      recipe: recipeWithDefaults(3.5),
      config: { budget_usd: 2.0 },
    });
    expect(r).toEqual({ usd: 3.5, source: 'recipe-defaults' });
  });

  it('user-config is used when recipe lacks defaults', () => {
    const r = resolveBudgetUsd({
      recipe: recipeWithDefaults(),
      config: { budget_usd: 1.25 },
    });
    expect(r).toEqual({ usd: 1.25, source: 'user-config' });
  });

  it('hard-coded fallback kicks in when nothing else is set', () => {
    const r = resolveBudgetUsd({ config: emptyConfig });
    expect(r).toEqual({ usd: 2.0, source: 'built-in' });
  });

  it('CLI flag below the 0.01 floor is clamped', () => {
    const r = resolveBudgetUsd({ cliFlag: '0', config: emptyConfig });
    expect(r.usd).toBe(0.01);
    expect(r.source).toBe('cli-flag');
  });

  it('non-numeric CLI flag falls through to the next source', () => {
    const r = resolveBudgetUsd({
      cliFlag: 'garbage',
      recipe: recipeWithDefaults(3.5),
      config: emptyConfig,
    });
    expect(r.source).toBe('recipe-defaults');
    expect(r.usd).toBe(3.5);
  });
});

describe('resolveAssetBudgetUsd', () => {
  it('CLI flag with explicit "0" still counts (disables creative agents)', () => {
    const r = resolveAssetBudgetUsd({
      cliFlag: '0',
      recipe: recipeWithDefaults(undefined, 1.5),
      config: emptyConfig,
    });
    expect(r).toEqual({ usd: 0, source: 'cli-flag' });
  });

  it('env var beats recipe + config but loses to CLI', () => {
    const r = resolveAssetBudgetUsd({
      env: '1.25',
      recipe: recipeWithDefaults(undefined, 1.5),
      config: { assets: { budget_usd: 0.5 } },
    });
    expect(r).toEqual({ usd: 1.25, source: 'env' });

    const r2 = resolveAssetBudgetUsd({
      cliFlag: '0.1',
      env: '1.25',
      recipe: recipeWithDefaults(undefined, 1.5),
      config: { assets: { budget_usd: 0.5 } },
    });
    expect(r2).toEqual({ usd: 0.1, source: 'cli-flag' });
  });

  it('recipe.defaults.assetBudgetUsd = 0 is honored (not treated as absent)', () => {
    const r = resolveAssetBudgetUsd({
      recipe: recipeWithDefaults(undefined, 0),
      config: { assets: { budget_usd: 0.5 } },
    });
    expect(r).toEqual({ usd: 0, source: 'recipe-defaults' });
  });
});

describe('describeBudget', () => {
  it('formats each source distinguishably', () => {
    expect(describeBudget({ usd: 3.5, source: 'cli-flag' })).toBe('$3.50 (--budget-usd)');
    expect(describeBudget({ usd: 3.5, source: 'recipe-defaults' }, '2d-game')).toBe(
      '$3.50 (recipe defaults, 2d-game)',
    );
    expect(describeBudget({ usd: 2, source: 'user-config' })).toBe('$2.00 (user config)');
    expect(describeBudget({ usd: 2, source: 'built-in' })).toBe('$2.00 (built-in default)');
    expect(describeBudget({ usd: 0.5, source: 'env' })).toBe('$0.50 (env)');
  });
});
