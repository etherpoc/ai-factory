import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { WorkspaceHandle } from '../../core/types';
import { nullLogger } from '../../core/logger';
import { defaultScaffold } from '../../core/orchestrator';
import { loadRecipe } from '../../core/recipe-loader';

const REPO_ROOT = process.cwd();
const RECIPE_DIR = join(REPO_ROOT, 'recipes', 'web-app');

const TEMPLATE_FILES = [
  'package.json',
  'next.config.mjs',
  'tsconfig.json',
  'tailwind.config.ts',
  'postcss.config.mjs',
  'playwright.config.ts',
  'app/layout.tsx',
  'app/page.tsx',
  'app/globals.css',
  'tests/e2e/smoke.spec.ts',
  'tests/e2e/interaction.spec.ts',
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

describe('recipes/web-app', () => {
  it('recipe.yaml loads and passes schema validation', async () => {
    const recipe = await loadRecipe('web-app', { repoRoot: REPO_ROOT });
    expect(recipe.meta.type).toBe('web-app');
    expect(recipe.stack.framework).toBe('nextjs');
    expect(recipe.stack.deps).toEqual(
      expect.arrayContaining(['next', 'react', 'tailwindcss', '@playwright/test']),
    );
    expect(recipe.scaffold.type).toBe('template');
    const ids = recipe.evaluation.criteria.map((c) => c.id);
    expect(ids).toEqual(
      expect.arrayContaining(['builds', 'tests-pass', 'entrypoints-implemented', 'responsive']),
    );
    expect(recipe.evaluation.entrypoints).toEqual(['app/page.tsx']);
    expect(recipe.agentOverrides.programmer?.promptAppend).toMatch(/App Router/);
    expect(recipe.agentOverrides.tester?.promptAppend).toMatch(/3 主要ユーザーフロー/);
  });

  it.each(TEMPLATE_FILES)('template contains %s', async (rel) => {
    expect(await exists(join(RECIPE_DIR, 'template', rel))).toBe(true);
  });

  it('package.json declares Next.js, React, Tailwind and Playwright', async () => {
    const pkg = JSON.parse(
      await readFile(join(RECIPE_DIR, 'template', 'package.json'), 'utf8'),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(pkg.dependencies?.next).toBeDefined();
    expect(pkg.dependencies?.react).toBeDefined();
    expect(pkg.dependencies?.['react-dom']).toBeDefined();
    expect(pkg.devDependencies?.tailwindcss).toBeDefined();
    expect(pkg.devDependencies?.['@playwright/test']).toBeDefined();
    expect(pkg.devDependencies?.typescript).toBeDefined();
  });

  it('playwright.config.ts wires both desktop + mobile projects', async () => {
    const cfg = await readFile(join(RECIPE_DIR, 'template', 'playwright.config.ts'), 'utf8');
    expect(cfg).toContain('Desktop Chrome');
    expect(cfg).toContain('Pixel 7');
    expect(cfg).toContain("command: 'pnpm start'");
  });

  it('defaultScaffold copies template/* into workspace.dir', async () => {
    const dest = await mkdtemp(join(tmpdir(), 'uaf-webapp-'));
    try {
      const recipe = await loadRecipe('web-app', { repoRoot: REPO_ROOT });
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
      const page = await readFile(join(dest, 'app', 'page.tsx'), 'utf8');
      expect(page).toContain('data-testid="title"');
    } finally {
      await rm(dest, { recursive: true, force: true });
    }
  });
});
