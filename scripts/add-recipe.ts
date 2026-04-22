/**
 * Phase 7: thin wrapper that delegates to `uaf add-recipe`.
 *
 * Kept for backward compatibility. Prefer `uaf add-recipe --type <t> --description "<d>"`.
 */
import { parseArgs } from 'node:util';
import { runAddRecipe, type AddRecipeOptions } from '../cli/commands/add-recipe.js';
import { printError } from '../cli/ui/errors.js';
import { createCliLogger } from '../cli/ui/logger.js';
import { exitCodeFor } from '../cli/ui/exit-codes.js';

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      type: { type: 'string' },
      description: { type: 'string' },
      'budget-usd': { type: 'string' },
      'max-rounds': { type: 'string' },
      model: { type: 'string' },
      reference: { type: 'string' },
      verbose: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (values.help || !values.type || !values.description) {
    process.stdout.write(
      `Usage: pnpm tsx scripts/add-recipe.ts --type <name> --description "<text>" [options]\n\n` +
        `(Legacy wrapper — prefer \`uaf add-recipe --type <name> --description "<text>"\` in Phase 7.)\n\n` +
        `Options:\n` +
        `  --type <name>            Recipe slug (kebab-case)\n` +
        `  --description "<text>"   Natural-language stack description\n` +
        `  --budget-usd <usd>       Budget cap (informational)\n` +
        `  --max-rounds <n>         Cap on tool-use rounds\n` +
        `  --model <id>             Override builder model\n` +
        `  --reference <type>       Structurally similar existing recipe to clone\n` +
        `  --verbose                Show detailed logs and full stack traces\n`,
    );
    return values.help ? 0 : 2;
  }

  const opts: AddRecipeOptions = {
    type: values.type,
    description: values.description,
    ...(values.reference !== undefined ? { reference: values.reference } : {}),
    ...(values['budget-usd'] !== undefined ? { budgetUsd: values['budget-usd'] } : {}),
    ...(values['max-rounds'] !== undefined ? { maxRounds: values['max-rounds'] } : {}),
    ...(values.model !== undefined ? { model: values.model } : {}),
  };

  const logger = createCliLogger({ verbose: values.verbose });
  try {
    await runAddRecipe(opts, { verbose: values.verbose });
    return 0;
  } catch (err) {
    printError(err, logger);
    return exitCodeFor(err);
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exit(1);
  },
);
