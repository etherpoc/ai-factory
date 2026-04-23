/**
 * Budget resolution (Phase 7.8.11).
 *
 * Priority order, highest first:
 *   1. CLI flag (`--budget-usd` / `--asset-budget-usd`)
 *   2. Environment variable (`UAF_*`) — for asset budget only; the LLM budget
 *      has no env counterpart historically, we keep that asymmetry
 *   3. Recipe `defaults` (Phase 7.8.11, per-recipe-author recommendation)
 *   4. Global config (`~/.uaf/config.yaml` `budget_usd` / `assets.budget_usd`)
 *   5. Hard-coded last-resort fallback
 *
 * The function returns both the resolved value and the source so callers can
 * log it (important for auditability — "why did this run use $3.50?").
 */
import type { Recipe } from '../../core/types.js';
import type { UafConfig } from '../config/schema.js';

export type BudgetSource =
  | 'cli-flag'
  | 'env'
  | 'recipe-defaults'
  | 'user-config'
  | 'built-in';

export interface ResolvedBudget {
  usd: number;
  source: BudgetSource;
}

const HARDCODED_BUDGET_USD = 2.0;
const HARDCODED_ASSET_BUDGET_USD = 2.0;

export interface ResolveBudgetArgs {
  /** Raw `--budget-usd` string as handed in by commander. Undefined if the flag was not passed. */
  cliFlag?: string | undefined;
  recipe?: Recipe | undefined;
  config: UafConfig;
}

export function resolveBudgetUsd(args: ResolveBudgetArgs): ResolvedBudget {
  // 1. CLI flag
  if (args.cliFlag !== undefined) {
    const n = Number.parseFloat(args.cliFlag);
    if (Number.isFinite(n)) {
      return { usd: Math.max(0.01, n), source: 'cli-flag' };
    }
  }
  // 2. (no env for LLM budget by historical design)
  // 3. Recipe defaults
  const recipeDefault = args.recipe?.defaults?.budgetUsd;
  if (typeof recipeDefault === 'number' && recipeDefault > 0) {
    return { usd: recipeDefault, source: 'recipe-defaults' };
  }
  // 4. User config
  if (typeof args.config.budget_usd === 'number' && args.config.budget_usd > 0) {
    return { usd: args.config.budget_usd, source: 'user-config' };
  }
  // 5. Hard-coded fallback
  return { usd: HARDCODED_BUDGET_USD, source: 'built-in' };
}

export interface ResolveAssetBudgetArgs {
  cliFlag?: string | undefined;
  env?: string | undefined;
  recipe?: Recipe | undefined;
  config: UafConfig;
}

export function resolveAssetBudgetUsd(args: ResolveAssetBudgetArgs): ResolvedBudget {
  // 1. CLI flag (may legitimately be "0" to disable creative agents)
  if (args.cliFlag !== undefined) {
    const n = Number.parseFloat(args.cliFlag);
    if (Number.isFinite(n)) {
      return { usd: Math.max(0, n), source: 'cli-flag' };
    }
  }
  // 2. Env var
  if (args.env !== undefined) {
    const n = Number.parseFloat(args.env);
    if (Number.isFinite(n) && n >= 0) {
      return { usd: n, source: 'env' };
    }
  }
  // 3. Recipe defaults
  const recipeDefault = args.recipe?.defaults?.assetBudgetUsd;
  if (typeof recipeDefault === 'number' && recipeDefault >= 0) {
    return { usd: recipeDefault, source: 'recipe-defaults' };
  }
  // 4. User config
  if (typeof args.config.assets?.budget_usd === 'number' && args.config.assets.budget_usd >= 0) {
    return { usd: args.config.assets.budget_usd, source: 'user-config' };
  }
  // 5. Hard-coded fallback
  return { usd: HARDCODED_ASSET_BUDGET_USD, source: 'built-in' };
}

/**
 * Human-friendly one-liner for the run header and halt hint.
 *   "$3.50 (recipe defaults, 2d-game)"
 */
export function describeBudget(resolved: ResolvedBudget, recipeType?: string): string {
  const pretty = `$${resolved.usd.toFixed(2)}`;
  switch (resolved.source) {
    case 'cli-flag':
      return `${pretty} (--budget-usd)`;
    case 'env':
      return `${pretty} (env)`;
    case 'recipe-defaults':
      return `${pretty} (recipe defaults${recipeType ? `, ${recipeType}` : ''})`;
    case 'user-config':
      return `${pretty} (user config)`;
    case 'built-in':
      return `${pretty} (built-in default)`;
  }
}
