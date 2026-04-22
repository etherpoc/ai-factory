/**
 * Phase 11.a.3 regression: recipe schema accepts the new `agents` and
 * `assets` sections, rejects unknown roles, and is backward compatible
 * (recipes without these sections still load).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRecipe } from '../../core/recipe-loader.js';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'uaf-recipe-'));
  await mkdir(join(root, 'recipes', 'demo'), { recursive: true });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writeRecipe(body: string): Promise<void> {
  await writeFile(join(root, 'recipes', 'demo', 'recipe.yaml'), body, 'utf8');
}

const baseYaml = `
meta:
  type: demo
  version: 1.0.0
  description: demo
stack:
  language: typescript
  framework: none
  deps: []
scaffold:
  type: template
  path: template
build:
  command: 'true'
  timeoutSec: 1
test:
  command: 'true'
  timeoutSec: 1
evaluation:
  criteria: []
`;

describe('recipe schema — Phase 11.a additions', () => {
  it('loads a pre-Phase-11.a recipe (no agents, no assets)', async () => {
    await writeRecipe(baseYaml);
    const r = await loadRecipe('demo', { repoRoot: root });
    expect(r.agents).toBeUndefined();
    expect(r.assets).toBeUndefined();
  });

  it('parses agents.required and agents.optional', async () => {
    await writeRecipe(
      baseYaml +
        `
agents:
  required: [director, architect, programmer, tester, reviewer, evaluator]
  optional: [artist, sound, critic]
`,
    );
    const r = await loadRecipe('demo', { repoRoot: root });
    expect(r.agents?.required).toContain('director');
    expect(r.agents?.optional).toEqual(['artist', 'sound', 'critic']);
  });

  it('rejects unknown roles in agents arrays', async () => {
    await writeRecipe(
      baseYaml +
        `
agents:
  required: [director]
  optional: [hacker]
`,
    );
    await expect(loadRecipe('demo', { repoRoot: root })).rejects.toThrow();
  });

  it('parses assets.image and assets.audio with budgets', async () => {
    await writeRecipe(
      baseYaml +
        `
assets:
  image:
    defaultStyle: pixel-art
    defaultProvider: replicate
    budget:
      maxUsd: 1.5
      maxCount: 20
  audio:
    defaultProvider: elevenlabs
    budget:
      maxUsd: 0.5
      maxCount: 10
`,
    );
    const r = await loadRecipe('demo', { repoRoot: root });
    expect(r.assets?.image?.defaultStyle).toBe('pixel-art');
    expect(r.assets?.image?.budget?.maxUsd).toBe(1.5);
    expect(r.assets?.audio?.budget?.maxCount).toBe(10);
  });

  it('rejects negative budget values', async () => {
    await writeRecipe(
      baseYaml +
        `
assets:
  image:
    budget:
      maxUsd: -0.5
`,
    );
    await expect(loadRecipe('demo', { repoRoot: root })).rejects.toThrow();
  });

  it('rejects unknown defaultStyle enum value', async () => {
    await writeRecipe(
      baseYaml +
        `
assets:
  image:
    defaultStyle: anime-vaporwave
`,
    );
    await expect(loadRecipe('demo', { repoRoot: root })).rejects.toThrow();
  });
});

describe('recipe schema — real recipe files load with new sections', () => {
  // Integration check: all 7 real recipes are runtime-loadable with the
  // extended schema. This catches typos in YAML additions during Phase 11.a.3.
  it.each(['2d-game', '3d-game', 'web-app', 'mobile-app', 'desktop-app', 'cli', 'api'])(
    'real recipe %s loads cleanly',
    async (type) => {
      const r = await loadRecipe(type, { repoRoot: process.cwd() });
      expect(r.meta.type).toBe(type);
    },
  );

  it('2d-game has artist + sound + critic as optional', async () => {
    const r = await loadRecipe('2d-game', { repoRoot: process.cwd() });
    expect(r.agents?.optional).toEqual(expect.arrayContaining(['artist', 'sound', 'critic']));
  });

  it('cli has only writer as optional (no visuals/audio)', async () => {
    const r = await loadRecipe('cli', { repoRoot: process.cwd() });
    expect(r.agents?.optional).toEqual(['writer']);
  });
});
