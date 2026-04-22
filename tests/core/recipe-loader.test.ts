import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RecipeLoadError, loadRecipe } from '../../core/recipe-loader';

const validYaml = `
meta:
  type: demo
  version: 1.0.0
  description: a demo recipe
stack:
  language: typescript
  framework: vite
  deps:
    - vite
scaffold:
  type: generator
  command: 'npm create vite@latest'
build:
  command: 'pnpm build'
  timeoutSec: 120
test:
  command: 'pnpm test'
  timeoutSec: 180
evaluation:
  criteria:
    - id: builds
      description: builds
      required: true
`;

describe('recipe-loader', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'uaf-recipes-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function writeRecipe(type: string, yaml: string) {
    const dir = join(root, 'recipes', type);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'recipe.yaml'), yaml, 'utf8');
  }

  it('loads a valid recipe', async () => {
    await writeRecipe('demo', validYaml);
    const recipe = await loadRecipe('demo', { repoRoot: root });
    expect(recipe.meta.type).toBe('demo');
    expect(recipe.scaffold.type).toBe('generator');
    expect(recipe.build.timeoutSec).toBe(120);
    expect(recipe.agentOverrides).toEqual({});
  });

  it('errors when recipe file is missing', async () => {
    await expect(loadRecipe('missing', { repoRoot: root })).rejects.toBeInstanceOf(RecipeLoadError);
  });

  it('rejects meta.type mismatch with directory', async () => {
    await writeRecipe('demo', validYaml.replace('type: demo', 'type: other'));
    await expect(loadRecipe('demo', { repoRoot: root })).rejects.toThrow(/does not match/);
  });

  it('reports zod-level validation errors with path context', async () => {
    const bad = validYaml.replace('timeoutSec: 120', 'timeoutSec: -1');
    await writeRecipe('demo', bad);
    try {
      await loadRecipe('demo', { repoRoot: root });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RecipeLoadError);
      const loadErr = err as RecipeLoadError;
      expect(loadErr.details.join('\n')).toMatch(/build\.timeoutSec/);
    }
  });

  it('accepts agentOverrides when present', async () => {
    const withOverrides =
      validYaml +
      `
agentOverrides:
  programmer:
    promptAppend: 'hello'
    additionalTools:
      - fs-read
`;
    await writeRecipe('demo', withOverrides);
    const recipe = await loadRecipe('demo', { repoRoot: root });
    expect(recipe.agentOverrides.programmer?.promptAppend).toBe('hello');
    expect(recipe.agentOverrides.programmer?.additionalTools).toEqual(['fs-read']);
  });
});
