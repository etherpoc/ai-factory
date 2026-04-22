/**
 * Phase 7.4 regression for cli/interactive/wizard.ts.
 *
 * Uses DI to replace the real `@inquirer/prompts`-backed prompter with a
 * programmable fake. This keeps the tests hermetic (no stdin, no TTY) and
 * lets us verify the exact arguments the wizard passes to `runCreate` /
 * `runAddRecipe`.
 */
import { describe, it, expect } from 'vitest';
import type { Prompter } from '../../cli/interactive/prompts.js';
import {
  runAddRecipeWizard,
  runCreateWizard,
  runWizard,
} from '../../cli/interactive/wizard.js';
import { UafError } from '../../cli/ui/errors.js';

/**
 * Minimal scripted prompter. Each prompt method pops its answer off the
 * matching queue and records the config it was given (for assertions).
 */
function scriptedPrompter(script: {
  inputs?: string[];
  selects?: unknown[];
  confirms?: boolean[];
  numbers?: Array<number | undefined>;
}): Prompter & { seen: { inputs: unknown[]; selects: unknown[]; confirms: unknown[]; numbers: unknown[] } } {
  const seen = { inputs: [] as unknown[], selects: [] as unknown[], confirms: [] as unknown[], numbers: [] as unknown[] };
  return {
    async input(config) {
      seen.inputs.push(config);
      if (!script.inputs || script.inputs.length === 0) throw new Error('no input answer');
      return script.inputs.shift()!;
    },
    async select<T>(config: Parameters<Prompter['select']>[0]) {
      seen.selects.push(config);
      if (!script.selects || script.selects.length === 0) throw new Error('no select answer');
      return script.selects.shift() as T;
    },
    async confirm(config) {
      seen.confirms.push(config);
      if (!script.confirms || script.confirms.length === 0) throw new Error('no confirm answer');
      return script.confirms.shift()!;
    },
    async number(config) {
      seen.numbers.push(config);
      if (!script.numbers || script.numbers.length === 0) throw new Error('no number answer');
      return script.numbers.shift();
    },
    seen,
  };
}

describe('cli/interactive/wizard — runCreateWizard', () => {
  it('collects request + recipe + budget + maxIter and calls runCreate', async () => {
    const prompter = scriptedPrompter({
      inputs: ['2Dの避けゲーム'],
      selects: ['2d-game'],
      numbers: [0.5, 2],
    });
    const calls: Array<Record<string, unknown>> = [];
    await runCreateWizard({
      prompter,
      async runCreate(o) {
        calls.push(o);
      },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      request: '2Dの避けゲーム',
      recipe: '2d-game',
      budgetUsd: '0.5',
      maxIterations: '2',
    });
  });

  it('empty recipe choice maps to classifier (no recipe in opts)', async () => {
    const prompter = scriptedPrompter({
      inputs: ['foo'],
      selects: [''], // "auto (classifier)"
      numbers: [1, 3],
    });
    const calls: Array<Record<string, unknown>> = [];
    await runCreateWizard({
      prompter,
      async runCreate(o) {
        calls.push(o);
      },
    });
    expect(calls[0]).not.toHaveProperty('recipe');
  });

  it('rejects empty request via validator', async () => {
    const prompter = scriptedPrompter({ inputs: [''], selects: [], numbers: [] });
    // The validator lives inside the input config; this test observes that
    // the config object carries a validate function that catches empty
    // strings. (The scripted prompter doesn't run validate itself.)
    try {
      await runCreateWizard({ prompter, async runCreate() {} });
    } catch {
      // later prompts fail (no answers); we only care about the validator.
    }
    const inputCfg = prompter.seen.inputs[0] as { validate?: (v: string) => boolean | string };
    expect(inputCfg.validate).toBeTypeOf('function');
    expect(inputCfg.validate!('')).not.toBe(true);
    expect(inputCfg.validate!('x')).toBe(true);
  });
});

describe('cli/interactive/wizard — runAddRecipeWizard', () => {
  it('collects type + description + reference and calls runAddRecipe', async () => {
    const prompter = scriptedPrompter({
      inputs: ['3d-game-vr', 'VR-capable 3d-game recipe'],
      selects: ['3d-game'],
      confirms: [true],
    });
    const calls: Array<Record<string, unknown>> = [];
    await runAddRecipeWizard({
      prompter,
      async runAddRecipe(o) {
        calls.push(o);
      },
    });
    expect(calls[0]).toEqual({
      type: '3d-game-vr',
      description: 'VR-capable 3d-game recipe',
      reference: '3d-game',
    });
  });

  it('skipping reference omits it from the call', async () => {
    const prompter = scriptedPrompter({
      inputs: ['novel', 'brand new'],
      confirms: [false],
    });
    const calls: Array<Record<string, unknown>> = [];
    await runAddRecipeWizard({
      prompter,
      async runAddRecipe(o) {
        calls.push(o);
      },
    });
    expect(calls[0]).not.toHaveProperty('reference');
  });

  it('type validator rejects non-kebab-case input', async () => {
    const prompter = scriptedPrompter({ inputs: ['X'], selects: [], confirms: [] });
    try {
      await runAddRecipeWizard({ prompter, async runAddRecipe() {} });
    } catch {
      // ignore — we only care about the validator below
    }
    const v = (prompter.seen.inputs[0] as { validate: (s: string) => boolean | string }).validate;
    expect(v('')).not.toBe(true);
    expect(v('Foo')).not.toBe(true); // uppercase rejected
    expect(v('good-name')).toBe(true);
    expect(v('-nope')).not.toBe(true); // leading dash rejected
  });
});

describe('cli/interactive/wizard — runWizard top menu', () => {
  it('choosing "exit" returns quietly', async () => {
    const prompter = scriptedPrompter({ selects: ['exit'] });
    await expect(runWizard({ prompter })).resolves.toBeUndefined();
  });

  it('choosing "create" dispatches to runCreateWizard', async () => {
    const prompter = scriptedPrompter({
      selects: ['create', '2d-game'],
      inputs: ['make a game'],
      numbers: [1, 3],
    });
    let received: Record<string, unknown> | undefined;
    await runWizard({
      prompter,
      async runCreate(o) {
        received = o;
      },
    });
    expect(received).toBeDefined();
    expect(received!.request).toBe('make a game');
  });

  it('choosing "add-recipe" dispatches to runAddRecipeWizard', async () => {
    const prompter = scriptedPrompter({
      selects: ['add-recipe'],
      inputs: ['my-new', 'cool recipe'],
      confirms: [false],
    });
    let received: Record<string, unknown> | undefined;
    await runWizard({
      prompter,
      async runAddRecipe(o) {
        received = o;
      },
    });
    expect(received).toEqual({ type: 'my-new', description: 'cool recipe' });
  });

  it('propagates UafError from sub-wizards', async () => {
    const prompter = scriptedPrompter({ selects: ['create'], inputs: ['x'], numbers: [] });
    // No recipe select / no number answers → our fake throws; ensure the
    // wizard itself doesn't swallow the error.
    const err = (await runWizard({ prompter }).catch((e) => e)) as unknown;
    expect(err).toBeInstanceOf(Error);
  });
});

describe('cli/interactive/prompts — abort handling', () => {
  it('translates ExitPromptError into UafError(USER_ABORT)', async () => {
    const { withAbortHandling } = await import('../../cli/interactive/prompts.js');
    const abortErr = new Error('User force closed the prompt with SIGINT');
    abortErr.name = 'ExitPromptError';
    const err = (await withAbortHandling(async () => {
      throw abortErr;
    }).catch((e) => e)) as unknown;
    expect(err).toBeInstanceOf(UafError);
    expect((err as UafError).code).toBe('USER_ABORT');
  });

  it('passes through unrelated errors', async () => {
    const { withAbortHandling } = await import('../../cli/interactive/prompts.js');
    const other = new Error('something else');
    const err = (await withAbortHandling(async () => {
      throw other;
    }).catch((e) => e)) as unknown;
    expect(err).toBe(other);
  });
});
