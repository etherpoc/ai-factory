/**
 * Phase 7.3 regression for cli/commands/create.ts.
 *
 * These tests cover the fast-fail branches only. Orchestrator integration
 * sits in Phase 7.7 and touches the real Claude API, so it lives in a
 * separate manual run. The goal here is to lock the preconditions:
 *
 *   empty request  →  falls through to the wizard (NOT_IMPLEMENTED in 7.3)
 *   no API key     →  API_KEY_MISSING (exit 6)
 */
import { afterEach, describe, expect, it } from 'vitest';
import { UafError } from '../../cli/ui/errors.js';
import { runCreate } from '../../cli/commands/create.js';

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

describe('cli/commands/create — preconditions', () => {
  // Phase 7.4 moved the "empty request → wizard" routing up into the
  // commander action handler. `runCreate` itself is now a pure function that
  // rejects an empty request as a caller bug.
  it('empty request throws ARG_MISSING (defensive guard)', async () => {
    const err = (await runCreate({}).catch((e) => e)) as unknown;
    expect(err).toBeInstanceOf(UafError);
    expect((err as UafError).code).toBe('ARG_MISSING');
  });

  it('whitespace-only request throws ARG_MISSING', async () => {
    const err = (await runCreate({ request: '   ' }).catch((e) => e)) as unknown;
    expect(err).toBeInstanceOf(UafError);
    expect((err as UafError).code).toBe('ARG_MISSING');
  });

  it('missing ANTHROPIC_API_KEY → API_KEY_MISSING', async () => {
    unsetApiKey();
    const err = (await runCreate({ request: 'test' }).catch((e) => e)) as unknown;
    expect(err).toBeInstanceOf(UafError);
    expect((err as UafError).code).toBe('API_KEY_MISSING');
  });
});
