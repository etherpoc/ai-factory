/**
 * Tests for meta/recipe-builder.ts (Phase 5).
 *
 * Uses a mocked Anthropic client so we can drive deterministic tool-use
 * rounds without hitting the real API. Covers atomic rollback semantics.
 */
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import {
  RecipeBuildError,
  buildRecipe,
  extractVerificationEvidence,
  validateRecipeType,
} from '../../meta/recipe-builder';
import type { Recipe } from '../../core/types';

/** Minimal template fixture: a _template dir with the 3 files recipe-builder expects. */
async function seedTemplate(repoRoot: string): Promise<void> {
  await mkdir(join(repoRoot, 'recipes', '_template', 'prompts'), { recursive: true });
  await mkdir(join(repoRoot, 'recipes', '_template', 'template'), { recursive: true });
  await writeFile(
    join(repoRoot, 'recipes', '_template', 'recipe.yaml'),
    'meta:\n  type: PLACEHOLDER-TYPE\n',
    'utf8',
  );
  await writeFile(join(repoRoot, 'recipes', '_template', 'README.md'), '# TEMPLATE\n', 'utf8');
  await writeFile(
    join(repoRoot, 'recipes', '_template', 'prompts', 'programmer.md'),
    '# TODO\n',
    'utf8',
  );
  await writeFile(join(repoRoot, 'recipes', '_template', 'template', '.gitkeep'), '', 'utf8');
  // Seed a minimal package.json so the scaffold validation passes when the LLM
  // doesn't explicitly write one (real runs will overwrite this).
  await writeFile(
    join(repoRoot, 'recipes', '_template', 'template', 'package.json'),
    '{"name":"placeholder","private":true}\n',
    'utf8',
  );
}

/** Build a fake Anthropic client that executes a scripted series of responses. */
function mockClient(responses: object[]): Anthropic {
  const create = vi.fn();
  for (const r of responses) create.mockResolvedValueOnce(r);
  return { messages: { create } } as unknown as Anthropic;
}

const USAGE = {
  input_tokens: 100,
  output_tokens: 50,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
};

/** Scripted tool_use round */
function toolUse(
  name: string,
  input: Record<string, unknown>,
  id: string = `tu_${Math.random().toString(36).slice(2)}`,
): object {
  return {
    content: [{ type: 'tool_use', id, name, input }],
    stop_reason: 'tool_use',
    usage: USAGE,
  };
}

/** Scripted end_turn response */
function endTurn(text: string): object {
  return {
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: USAGE,
  };
}

/** A valid recipe.yaml body for the given type. */
function validRecipeYaml(type: string): string {
  return `meta:
  type: ${type}
  version: 1.0.0
  description: Test recipe
stack:
  language: typescript
  framework: node
  deps:
    - zod
scaffold:
  type: template
  path: template
agentOverrides:
  programmer:
    promptAppend: 'write clean code'
build:
  command: 'pnpm install --prefer-offline --ignore-workspace && pnpm --ignore-workspace exec tsc --noEmit'
  timeoutSec: 120
test:
  command: 'pnpm install --prefer-offline --ignore-workspace && pnpm --ignore-workspace exec vitest run'
  timeoutSec: 180
evaluation:
  entrypoints:
    - src/main.ts
  criteria:
    - id: builds
      description: builds
      required: true
    - id: tests-pass
      description: tests pass
      required: true
    - id: entrypoints-implemented
      description: entrypoint written
      required: true
`;
}

describe('validateRecipeType', () => {
  it('accepts kebab-case names', () => {
    expect(() => validateRecipeType('cli')).not.toThrow();
    expect(() => validateRecipeType('2d-game')).not.toThrow();
    expect(() => validateRecipeType('mobile-app-v2')).not.toThrow();
  });

  it('rejects invalid forms', () => {
    expect(() => validateRecipeType('')).toThrow(RecipeBuildError);
    expect(() => validateRecipeType('CamelCase')).toThrow();
    expect(() => validateRecipeType('my.recipe')).toThrow();
    expect(() => validateRecipeType('-leading')).toThrow();
    expect(() => validateRecipeType('trailing-')).toThrow();
    expect(() => validateRecipeType('path/injection')).toThrow();
  });

  it('rejects reserved names', () => {
    expect(() => validateRecipeType('_template')).toThrow();
    expect(() => validateRecipeType('.tmp')).toThrow();
  });
});

describe('buildRecipe — atomic rollback', () => {
  let repoRoot: string;
  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'uaf-builder-'));
    await seedTemplate(repoRoot);
  });
  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  async function exists(p: string): Promise<boolean> {
    try {
      await access(p);
      return true;
    } catch {
      return false;
    }
  }

  it('refuses to start when recipes/<type> already exists', async () => {
    await mkdir(join(repoRoot, 'recipes', 'cli'), { recursive: true });
    await expect(
      buildRecipe({
        type: 'cli',
        description: 'x',
        repoRoot,
        client: mockClient([]),
      }),
    ).rejects.toThrow(/already exists/);
  });

  it('refuses to start when _template is missing', async () => {
    await rm(join(repoRoot, 'recipes', '_template'), { recursive: true, force: true });
    await expect(
      buildRecipe({
        type: 'cli',
        description: 'x',
        repoRoot,
        client: mockClient([]),
      }),
    ).rejects.toThrow(/_template/);
  });

  it('on LLM failure, removes the tmp dir and leaves recipes/<type> untouched', async () => {
    const client = mockClient([]);
    // First call to messages.create has no scripted response → rejects with "no more mock values"
    // effectively simulating an API error.
    vi.mocked(
      (client as unknown as { messages: { create: ReturnType<typeof vi.fn> } }).messages.create,
    ).mockRejectedValueOnce(new Error('simulated API failure'));

    await expect(
      buildRecipe({
        type: 'cli',
        description: 'x',
        repoRoot,
        client,
      }),
    ).rejects.toThrow(/simulated API failure/);

    expect(await exists(join(repoRoot, 'recipes', 'cli'))).toBe(false);
    // The .tmp scratch dir should have been cleaned up
    const tmpRoot = join(repoRoot, 'recipes', '.tmp');
    if (await exists(tmpRoot)) {
      const { readdir } = await import('node:fs/promises');
      const leftover = await readdir(tmpRoot);
      expect(leftover).toEqual([]);
    }
  });

  it('on validation failure (bad YAML), removes tmp and does not commit', async () => {
    // LLM returns immediately with end_turn, without writing anything. recipe.yaml
    // stays as "meta:\n  type: PLACEHOLDER-TYPE\n" which fails schema validation.
    const client = mockClient([
      {
        content: [{ type: 'text', text: 'done' }],
        stop_reason: 'end_turn',
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
    ]);

    await expect(
      buildRecipe({
        type: 'cli',
        description: 'x',
        repoRoot,
        client,
      }),
    ).rejects.toBeInstanceOf(RecipeBuildError);

    expect(await exists(join(repoRoot, 'recipes', 'cli'))).toBe(false);
  });

  it('succeeds when LLM writes a valid recipe + README; atomic rename commits', async () => {
    // Script: write recipe.yaml + README, then end_turn. skipSelfVerificationCheck bypasses P0.
    const client = mockClient([
      toolUse('write_file', { path: 'recipe.yaml', content: validRecipeYaml('cli') }),
      toolUse('write_file', {
        path: 'README.md',
        content: '# cli\n\nTest recipe for cli stack.\n',
      }),
      endTurn('Wrote recipe.yaml + README'),
    ]);

    const result = await buildRecipe({
      type: 'cli',
      description: 'CLI test',
      repoRoot,
      client,
      maxToolRounds: 10,
      skipSelfVerificationCheck: true,
    });

    expect(result.type).toBe('cli');
    expect(await exists(join(repoRoot, 'recipes', 'cli'))).toBe(true);
    expect(await exists(join(repoRoot, 'recipes', 'cli', 'recipe.yaml'))).toBe(true);
    expect(await exists(join(repoRoot, 'recipes', 'cli', 'template', '.gitkeep'))).toBe(true);
    const yamlBack = await readFile(join(repoRoot, 'recipes', 'cli', 'recipe.yaml'), 'utf8');
    expect(yamlBack).toContain('type: cli');
  });

  it('rejects output where build.command lacks --ignore-workspace (F1 guard)', async () => {
    const yamlNoFlag = validRecipeYaml('cli').replace(/--ignore-workspace /g, '');
    const toolUseResponse = {
      content: [
        {
          type: 'tool_use',
          id: 'tu_1',
          name: 'write_file',
          input: { path: 'recipe.yaml', content: yamlNoFlag },
        },
      ],
      stop_reason: 'tool_use',
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    };
    const finalResponse = {
      content: [{ type: 'text', text: 'done' }],
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 120,
        output_tokens: 20,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    };
    const client = mockClient([toolUseResponse, finalResponse]);

    await expect(
      buildRecipe({
        type: 'cli',
        description: 'x',
        repoRoot,
        client,
        maxToolRounds: 5,
      }),
    ).rejects.toThrow(/--ignore-workspace/);
    expect(await exists(join(repoRoot, 'recipes', 'cli'))).toBe(false);
  });

  it('rejects output where meta.type does not match the requested type', async () => {
    const wrongTypeYaml = validRecipeYaml('cli').replace('type: cli', 'type: something-else');
    const toolUseResponse = {
      content: [
        {
          type: 'tool_use',
          id: 'tu_1',
          name: 'write_file',
          input: { path: 'recipe.yaml', content: wrongTypeYaml },
        },
      ],
      stop_reason: 'tool_use',
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    };
    const finalResponse = {
      content: [{ type: 'text', text: 'done' }],
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 120,
        output_tokens: 20,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    };
    const client = mockClient([toolUseResponse, finalResponse]);

    await expect(
      buildRecipe({
        type: 'cli',
        description: 'x',
        repoRoot,
        client,
        maxToolRounds: 5,
      }),
    ).rejects.toThrow(/meta\.type/);
    expect(await exists(join(repoRoot, 'recipes', 'cli'))).toBe(false);
  });

  it('rejects when build.command is missing `pnpm install` (Phase 5 follow-up)', async () => {
    const yamlNoInstall = validRecipeYaml('cli').replace(
      "command: 'pnpm install --prefer-offline --ignore-workspace && pnpm --ignore-workspace exec tsc --noEmit'",
      "command: 'pnpm --ignore-workspace exec tsc --noEmit'",
    );
    const toolUse = {
      content: [
        {
          type: 'tool_use',
          id: 'tu_1',
          name: 'write_file',
          input: { path: 'recipe.yaml', content: yamlNoInstall },
        },
      ],
      stop_reason: 'tool_use',
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    };
    const finalResp = {
      content: [{ type: 'text', text: 'done' }],
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 120,
        output_tokens: 20,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    };
    const client = mockClient([toolUse, finalResp]);

    await expect(
      buildRecipe({
        type: 'cli',
        description: 'x',
        repoRoot,
        client,
        maxToolRounds: 5,
      }),
    ).rejects.toThrow(/build\.command must include `pnpm install` or `npm install`/);
    expect(await exists(join(repoRoot, 'recipes', 'cli'))).toBe(false);
  });

  it('rejects when test.command is missing `pnpm install` (Phase 5 follow-up)', async () => {
    const yamlNoTestInstall = validRecipeYaml('cli').replace(
      "command: 'pnpm install --prefer-offline --ignore-workspace && pnpm --ignore-workspace exec vitest run'",
      "command: 'pnpm --ignore-workspace exec vitest run'",
    );
    const toolUse = {
      content: [
        {
          type: 'tool_use',
          id: 'tu_1',
          name: 'write_file',
          input: { path: 'recipe.yaml', content: yamlNoTestInstall },
        },
      ],
      stop_reason: 'tool_use',
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    };
    const finalResp = {
      content: [{ type: 'text', text: 'done' }],
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 120,
        output_tokens: 20,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    };
    const client = mockClient([toolUse, finalResp]);

    await expect(
      buildRecipe({
        type: 'cli',
        description: 'x',
        repoRoot,
        client,
        maxToolRounds: 5,
      }),
    ).rejects.toThrow(/test\.command must include `pnpm install` or `npm install`/);
    expect(await exists(join(repoRoot, 'recipes', 'cli'))).toBe(false);
  });

  it('accepts `npm install` as an alternative to `pnpm install`', async () => {
    const yamlNpm = validRecipeYaml('cli')
      .replace(
        "command: 'pnpm install --prefer-offline --ignore-workspace && pnpm --ignore-workspace exec tsc --noEmit'",
        "command: 'npm install && npx --ignore-workspace tsc --noEmit'",
      )
      .replace(
        "command: 'pnpm install --prefer-offline --ignore-workspace && pnpm --ignore-workspace exec vitest run'",
        "command: 'npm install && npx --ignore-workspace vitest run'",
      );
    const client = mockClient([
      toolUse('write_file', { path: 'recipe.yaml', content: yamlNpm }),
      toolUse('write_file', {
        path: 'README.md',
        content: '# cli\n\nTest recipe for cli stack (npm variant).\n',
      }),
      endTurn('done'),
    ]);

    const result = await buildRecipe({
      type: 'cli',
      description: 'x',
      repoRoot,
      client,
      maxToolRounds: 5,
      skipSelfVerificationCheck: true,
    });
    expect(result.validated).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // P1 (F19): README.md must be updated from the _template stub
  // ---------------------------------------------------------------------------

  it('P1: rejects when README.md is byte-identical to _template/README.md', async () => {
    const client = mockClient([
      toolUse('write_file', { path: 'recipe.yaml', content: validRecipeYaml('cli') }),
      // Note: does NOT write README — it stays as "# TEMPLATE\n" from the _template clone
      endTurn('done'),
    ]);

    await expect(
      buildRecipe({
        type: 'cli',
        description: 'x',
        repoRoot,
        client,
        maxToolRounds: 5,
        skipSelfVerificationCheck: true,
      }),
    ).rejects.toThrow(/byte-identical to _template/);
  });

  it('P1: rejects when README.md does not mention the recipe type', async () => {
    const client = mockClient([
      toolUse('write_file', { path: 'recipe.yaml', content: validRecipeYaml('cli') }),
      toolUse('write_file', {
        path: 'README.md',
        content: '# Something Else\n\nThis README is not about the actual recipe.\n',
      }),
      endTurn('done'),
    ]);

    await expect(
      buildRecipe({
        type: 'cli',
        description: 'x',
        repoRoot,
        client,
        maxToolRounds: 5,
        skipSelfVerificationCheck: true,
      }),
    ).rejects.toThrow(/does not mention the recipe type "cli"/);
  });

  // ---------------------------------------------------------------------------
  // P0 (F19): self-verification evidence (bash install/build/test invocations)
  // ---------------------------------------------------------------------------

  it('P0: rejects when no `pnpm install` was observed in bash log', async () => {
    // LLM writes the files but never actually runs install/build/test via bash.
    const client = mockClient([
      toolUse('write_file', { path: 'recipe.yaml', content: validRecipeYaml('cli') }),
      toolUse('write_file', {
        path: 'README.md',
        content: '# cli\n\nRecipe for cli stack.\n',
      }),
      endTurn('done'),
    ]);

    await expect(
      buildRecipe({
        type: 'cli',
        description: 'x',
        repoRoot,
        client,
        maxToolRounds: 5,
        // NOTE: skipSelfVerificationCheck is NOT set → P0 is active
      }),
    ).rejects.toThrow(/self-verification \(Phase C\) is required/);
  });

});

// ---------------------------------------------------------------------------
// P0 helper: extractVerificationEvidence (pure function, no I/O)
// ---------------------------------------------------------------------------

describe('extractVerificationEvidence (P0 helper)', () => {
  /** Minimal Recipe stub for testing marker extraction. */
  function mkRecipe(buildCmd: string, testCmd: string): Recipe {
    return {
      meta: { type: 'cli', version: '1.0.0', description: 'test' },
      stack: { language: 'typescript', framework: 'node', deps: [] },
      scaffold: { type: 'template', path: 'template' },
      agentOverrides: {},
      build: { command: buildCmd, timeoutSec: 120 },
      test: { command: testCmd, timeoutSec: 180 },
      evaluation: { entrypoints: ['src/main.ts'], criteria: [] },
    } as unknown as Recipe;
  }

  const recipe = mkRecipe(
    'pnpm install --prefer-offline --ignore-workspace && pnpm --ignore-workspace exec tsc --noEmit',
    'pnpm install --prefer-offline --ignore-workspace && pnpm --ignore-workspace exec vitest run',
  );

  it('flags installOk/buildOk/testOk when all three commands succeeded', () => {
    const e = extractVerificationEvidence(
      [
        { command: 'pnpm install --prefer-offline --ignore-workspace', ok: true },
        { command: 'pnpm --ignore-workspace exec tsc --noEmit', ok: true },
        { command: 'pnpm --ignore-workspace exec vitest run', ok: true },
      ],
      recipe,
      'all green',
    );
    expect(e.installOk).toBe(true);
    expect(e.buildOk).toBe(true);
    expect(e.testOk).toBe(true);
  });

  it('flags installOk=false when no install was attempted', () => {
    const e = extractVerificationEvidence(
      [{ command: 'ls template', ok: true }],
      recipe,
      '',
    );
    expect(e.installOk).toBe(false);
  });

  it('does not count failed bash calls as evidence', () => {
    const e = extractVerificationEvidence(
      [
        { command: 'pnpm install --prefer-offline --ignore-workspace', ok: false },
        { command: 'pnpm --ignore-workspace exec vitest run', ok: false },
      ],
      recipe,
      '',
    );
    expect(e.installOk).toBe(false);
    expect(e.testOk).toBe(false);
  });

  it('accepts `build: SKIP(reason)` / `test: SKIP(reason)` in final text', () => {
    const e = extractVerificationEvidence(
      [{ command: 'pnpm install --prefer-offline --ignore-workspace', ok: true }],
      recipe,
      'build: SKIP(Android emulator required)\ntest: SKIP(needs physical device)',
    );
    expect(e.buildSkippedWithReason).toBe(true);
    expect(e.testSkippedWithReason).toBe(true);
  });

  it('requires a reason in SKIP(...) — bare `SKIP` alone is rejected', () => {
    const e = extractVerificationEvidence([], recipe, 'build: SKIP\ntest: SKIP()');
    expect(e.buildSkippedWithReason).toBe(false);
    expect(e.testSkippedWithReason).toBe(false);
  });

  it('accepts npm install variant', () => {
    const npmRecipe = mkRecipe(
      'npm install && npx tsc --noEmit',
      'npm install && npx vitest run',
    );
    const e = extractVerificationEvidence(
      [
        { command: 'npm install', ok: true },
        { command: 'npx tsc --noEmit', ok: true },
        { command: 'npx vitest run', ok: true },
      ],
      npmRecipe,
      '',
    );
    expect(e.installOk).toBe(true);
    expect(e.buildOk).toBe(true);
    expect(e.testOk).toBe(true);
  });
});
