/**
 * Retroactive F19 structural check: run validateBuiltRecipe against every
 * existing recipe and report failures.
 *
 *   pnpm tsx scripts/check-recipes.ts
 */
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { RecipeBuildError, validateBuiltRecipe } from '../meta/recipe-builder.js';

async function main(): Promise<number> {
  const repoRoot = process.cwd();
  const recipesDir = join(repoRoot, 'recipes');
  const entries = await readdir(recipesDir, { withFileTypes: true });
  const types = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('_') && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort();

  let failures = 0;
  for (const type of types) {
    const recipePath = join(recipesDir, type);
    try {
      await validateBuiltRecipe(recipePath, type, repoRoot);
      process.stdout.write(`  ok   ${type}\n`);
    } catch (err) {
      failures += 1;
      const msg = err instanceof Error ? err.message : String(err);
      process.stdout.write(`  FAIL ${type}: ${msg}\n`);
      if (err instanceof RecipeBuildError) {
        for (const d of err.details) process.stdout.write(`       - ${d}\n`);
      }
    }
  }
  process.stdout.write(`\n${types.length - failures}/${types.length} recipes pass F19 checks\n`);
  return failures === 0 ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exit(1);
  },
);
