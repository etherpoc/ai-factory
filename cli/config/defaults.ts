/**
 * Built-in defaults for the uaf CLI (Phase 7.2).
 *
 * Kept intentionally small: we only set top-level values that are purely
 * CLI-facing (budget, iteration caps, editor). Model defaults per role live
 * in `core/strategies/claude.ts` (`DEFAULT_MODELS_BY_ROLE`); when the user's
 * config omits them, the claude strategy keeps applying those — the config
 * merger never invents role-model bindings here.
 *
 * Workspace location: `undefined` means "relative ./workspace from repoRoot"
 * (the Phase 6 behavior). Only override if the user explicitly set it.
 */
import type { UafConfig } from './schema.js';

export const BUILT_IN_DEFAULTS: Required<
  Pick<UafConfig, 'budget_usd' | 'max_iterations' | 'max_rounds'>
> &
  UafConfig = {
  budget_usd: 2.0,
  max_iterations: 3,
  max_rounds: 30,
};

/** Canonical on-disk file names. */
export const CONFIG_FILES = {
  /** Relative to the user's home directory. */
  global: '.uaf/config.yaml',
  /** Relative to the project (cwd). */
  project: '.uafrc',
} as const;
