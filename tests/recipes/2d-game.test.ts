import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { WorkspaceHandle } from '../../core/types';
import { nullLogger } from '../../core/logger';
import { defaultScaffold } from '../../core/orchestrator';
import { loadRecipe } from '../../core/recipe-loader';

const REPO_ROOT = process.cwd();
const RECIPE_DIR = join(REPO_ROOT, 'recipes', '2d-game');

const TEMPLATE_FILES = [
  'package.json',
  'vite.config.ts',
  'tsconfig.json',
  'index.html',
  'playwright.config.ts',
  'src/main.ts',
  'src/scenes/MainScene.ts',
  'tests/e2e/smoke.spec.ts',
  'tests/e2e/gameplay.spec.ts',
  '.gitignore',
  'README.md',
];

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

describe('recipes/2d-game', () => {
  it('recipe.yaml loads and passes schema validation', async () => {
    const recipe = await loadRecipe('2d-game', { repoRoot: REPO_ROOT });
    expect(recipe.meta.type).toBe('2d-game');
    expect(recipe.meta.version).toBe('1.0.0');
    expect(recipe.stack.framework).toBe('phaser3');
    expect(recipe.stack.deps).toContain('phaser');
    expect(recipe.stack.deps).toContain('@playwright/test');
    expect(recipe.scaffold.type).toBe('template');
    if (recipe.scaffold.type === 'template') {
      expect(recipe.scaffold.path).toBe('template');
    }
    const ids = recipe.evaluation.criteria.map((c) => c.id);
    expect(ids).toContain('builds');
    expect(ids).toContain('tests-pass');
    expect(ids).toContain('entrypoints-implemented');
    expect(recipe.evaluation.entrypoints).toEqual(['src/scenes/MainScene.ts']);
    expect(recipe.agentOverrides.programmer?.promptAppend).toMatch(/Scene/);
    expect(recipe.agentOverrides.tester?.promptAppend).toMatch(/Playwright/);
  });

  it.each(TEMPLATE_FILES)('template contains %s', async (rel) => {
    expect(await exists(join(RECIPE_DIR, 'template', rel))).toBe(true);
  });

  it('package.json declares phaser and playwright', async () => {
    const pkg = JSON.parse(
      await readFile(join(RECIPE_DIR, 'template', 'package.json'), 'utf8'),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(pkg.dependencies?.phaser).toBeDefined();
    expect(pkg.devDependencies?.['@playwright/test']).toBeDefined();
    expect(pkg.devDependencies?.vite).toBeDefined();
  });

  it('defaultScaffold copies template/* into workspace.dir', async () => {
    const dest = await mkdtemp(join(tmpdir(), 'uaf-2dgame-'));
    try {
      const recipe = await loadRecipe('2d-game', { repoRoot: REPO_ROOT });
      const handle: WorkspaceHandle = {
        projectId: 'test',
        dir: dest,
        branch: 'uaf/test',
        cleanup: async () => undefined,
      };
      await defaultScaffold(recipe, handle, nullLogger, REPO_ROOT);
      for (const rel of TEMPLATE_FILES) {
        expect(await exists(join(dest, rel))).toBe(true);
      }
      // smoke spec should not be template-corrupted
      const spec = await readFile(join(dest, 'tests', 'e2e', 'smoke.spec.ts'), 'utf8');
      expect(spec).toContain("page.locator('canvas')");
    } finally {
      await rm(dest, { recursive: true, force: true });
    }
  });
});
