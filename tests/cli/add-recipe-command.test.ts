/**
 * Phase 7.3 regression for cli/commands/add-recipe.ts.
 *
 * Same philosophy as create-command.test.ts: lock preconditions only.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { UafError } from '../../cli/ui/errors.js';
import { runAddRecipe } from '../../cli/commands/add-recipe.js';

let savedKey: string | undefined;

afterEach(() => {
  if (savedKey !== undefined) {
    process.env.ANTHROPIC_API_KEY = savedKey;
    savedKey = undefined;
  }
});

function unsetApiKey(): void {
  savedKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
}

describe('cli/commands/add-recipe — preconditions', () => {
  // Phase 7.4: the commander action handler routes missing args to the
  // wizard. `runAddRecipe` itself rejects incomplete input as a bug.
  it('no type → ARG_MISSING', async () => {
    const err = (await runAddRecipe({ description: 'd' }).catch((e) => e)) as unknown;
    expect(err).toBeInstanceOf(UafError);
    expect((err as UafError).code).toBe('ARG_MISSING');
  });

  it('no description → ARG_MISSING', async () => {
    const err = (await runAddRecipe({ type: 't' }).catch((e) => e)) as unknown;
    expect(err).toBeInstanceOf(UafError);
    expect((err as UafError).code).toBe('ARG_MISSING');
  });

  it('missing ANTHROPIC_API_KEY → API_KEY_MISSING', async () => {
    unsetApiKey();
    const err = (await runAddRecipe({ type: 'x', description: 'y' }).catch((e) => e)) as unknown;
    expect(err).toBeInstanceOf(UafError);
    expect((err as UafError).code).toBe('API_KEY_MISSING');
  });
});
