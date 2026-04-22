/**
 * `uaf recipes` — list installed recipes.
 *
 * Walks `recipes/` (skipping `_template` and `.tmp`), loads each recipe.yaml
 * through the canonical `core/recipe-loader.ts`, and prints a table.
 */
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { colors } from '../ui/colors.js';
import { UafError } from '../ui/errors.js';

export interface RecipesOptions {
  json?: boolean;
}

export async function runRecipes(opts: RecipesOptions = {}, _global: unknown = {}): Promise<void> {
  const { loadRecipe } = await import('../../core/recipe-loader.js');
  const repoRoot = process.cwd();
  const recipesDir = join(repoRoot, 'recipes');

  let entries: string[];
  try {
    entries = await readdir(recipesDir);
  } catch (err) {
    throw new UafError(`cannot read recipes directory: ${recipesDir}`, {
      code: 'CONFIG_PARSE_ERROR',
      cause: err,
    });
  }

  const rows: Array<{
    type: string;
    version: string;
    description: string;
    framework: string;
    language: string;
  }> = [];

  for (const name of entries) {
    if (name.startsWith('_') || name.startsWith('.')) continue;
    const dir = join(recipesDir, name);
    try {
      const info = await stat(dir);
      if (!info.isDirectory()) continue;
    } catch {
      continue;
    }
    try {
      const recipe = await loadRecipe(name, { repoRoot });
      rows.push({
        type: recipe.meta.type,
        version: recipe.meta.version,
        description: recipe.meta.description,
        framework: recipe.stack.framework,
        language: recipe.stack.language,
      });
    } catch (err) {
      rows.push({
        type: name,
        version: 'invalid',
        description: err instanceof Error ? err.message : 'failed to load',
        framework: '—',
        language: '—',
      });
    }
  }

  rows.sort((a, b) => a.type.localeCompare(b.type));

  if (opts.json) {
    process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
    return;
  }

  if (rows.length === 0) {
    process.stderr.write(colors.dim('No recipes installed.\n'));
    return;
  }

  const header = ['TYPE', 'VERSION', 'STACK', 'DESCRIPTION'];
  const body = rows.map((r) => [r.type, r.version, `${r.framework} (${r.language})`, r.description]);
  const widths = header.map((_, i) =>
    Math.max(header[i]!.length, ...body.map((r) => r[i]!.length)),
  );
  const fmt = (cols: string[]): string => cols.map((c, i) => c.padEnd(widths[i]!)).join('  ');
  process.stdout.write(colors.bold(fmt(header)) + '\n');
  for (const row of body) process.stdout.write(fmt(row) + '\n');
}
