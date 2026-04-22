/**
 * Thin wrappers around `@inquirer/prompts` used by the wizard (Phase 7.4).
 *
 * Two jobs:
 *
 *   1. Re-export the primitives we actually use (`input`, `select`, `confirm`,
 *      `number`) so consumers only import from this module. Keeps the
 *      `@inquirer/prompts` coupling in one place.
 *
 *   2. Map Ctrl-C / `ExitPromptError` to `UafError(USER_ABORT)` so the process
 *      exits with code 8. Otherwise inquirer's default prints a stack trace
 *      and exits nonzero — not what we want when the user just wanted to quit.
 *
 * Dependency injection: every helper takes an optional `ask` parameter so
 * tests can stub it without monkey-patching the inquirer module. Production
 * callers leave it undefined; a no-arg call uses the real prompt.
 */
import { UafError } from '../ui/errors.js';

/** Minimal shape the wizard relies on; the real `@inquirer/prompts` exports match. */
export interface Prompter {
  input(config: InputConfig): Promise<string>;
  select<T>(config: SelectConfig<T>): Promise<T>;
  confirm(config: ConfirmConfig): Promise<boolean>;
  number(config: NumberConfig): Promise<number | undefined>;
}

export interface InputConfig {
  message: string;
  default?: string;
  validate?: (v: string) => boolean | string;
}

export interface SelectConfig<T> {
  message: string;
  choices: Array<{ name: string; value: T; description?: string }>;
  default?: T;
}

export interface ConfirmConfig {
  message: string;
  default?: boolean;
}

export interface NumberConfig {
  message: string;
  default?: number;
  min?: number;
  max?: number;
  validate?: (v: number | undefined) => boolean | string;
}

/**
 * Load the real @inquirer/prompts prompter. Kept as an async factory so
 * startup cost (the inquirer import is not tiny) only happens when a wizard
 * actually runs.
 */
export async function defaultPrompter(): Promise<Prompter> {
  const m = await import('@inquirer/prompts');
  return {
    input: async (config) => m.input(config as unknown as Parameters<typeof m.input>[0]),
    select: async (config) =>
      m.select(config as unknown as Parameters<typeof m.select>[0]) as Promise<
        typeof config extends SelectConfig<infer T> ? T : never
      >,
    confirm: async (config) => m.confirm(config as unknown as Parameters<typeof m.confirm>[0]),
    number: async (config) => m.number(config as unknown as Parameters<typeof m.number>[0]),
  };
}

/**
 * Run `fn` and translate `@inquirer/prompts` abort (Ctrl-C) into a clean
 * `UafError(USER_ABORT)`. All other errors pass through unchanged.
 */
export async function withAbortHandling<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    // Inquirer v8 throws `ExitPromptError` with name = "ExitPromptError". A
    // name check is enough — we avoid a structural import so tests don't need
    // inquirer loaded.
    if (err instanceof Error && (err.name === 'ExitPromptError' || /User force closed/.test(err.message))) {
      throw new UafError('aborted by user', {
        code: 'USER_ABORT',
        hint: 'Run the command again when ready.',
      });
    }
    throw err;
  }
}
