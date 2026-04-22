/**
 * Phase 7: thin wrapper that delegates to `uaf create`.
 *
 * The original `scripts/run.ts` (Phases 0-6) was the direct entry. Phase 7
 * moved the orchestration into `cli/commands/create.ts`; this file stays
 * around so existing invocations like
 *
 *   pnpm tsx scripts/run.ts --request "..." --recipe 2d-game
 *
 * continue to work verbatim. External flags map 1:1 to the CLI command.
 */
import { parseArgs } from 'node:util';
import { runCreate, type CreateOptions } from '../cli/commands/create.js';
import { UafError, printError } from '../cli/ui/errors.js';
import { createCliLogger } from '../cli/ui/logger.js';
import { exitCodeFor } from '../cli/ui/exit-codes.js';

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      request: { type: 'string' },
      recipe: { type: 'string' },
      'max-iterations': { type: 'string' },
      'budget-usd': { type: 'string' },
      'max-rounds': { type: 'string' },
      model: { type: 'string' },
      cleanup: { type: 'boolean', default: false },
      verbose: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (values.help || !values.request) {
    process.stdout.write(
      `Usage: pnpm tsx scripts/run.ts --request "<text>" [options]\n\n` +
        `(Legacy wrapper — prefer \`uaf create "<text>" [options]\` in Phase 7.)\n\n` +
        `Options:\n` +
        `  --recipe <type>          Skip classifier and force this recipe type\n` +
        `  --max-iterations <n>     Hard cap on the orchestrator loop\n` +
        `  --budget-usd <usd>       Halt when cumulative cost exceeds this\n` +
        `  --max-rounds <n>         Cap on tool-use rounds per agent\n` +
        `  --model <id>             Force this model for all roles\n` +
        `  --cleanup                Remove the workspace after completion\n` +
        `  --verbose                Show detailed logs and full stack traces\n`,
    );
    return values.help ? 0 : 2;
  }

  const opts: CreateOptions = {
    request: values.request,
    ...(values.recipe !== undefined ? { recipe: values.recipe } : {}),
    ...(values['max-iterations'] !== undefined
      ? { maxIterations: values['max-iterations'] }
      : {}),
    ...(values['budget-usd'] !== undefined ? { budgetUsd: values['budget-usd'] } : {}),
    ...(values['max-rounds'] !== undefined ? { maxRounds: values['max-rounds'] } : {}),
    ...(values.model !== undefined ? { model: values.model } : {}),
    ...(values.cleanup ? { cleanup: true } : {}),
  };

  const logger = createCliLogger({ verbose: values.verbose });
  try {
    await runCreate(opts, { verbose: values.verbose });
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

// Ensure UafError remains a reachable symbol for tooling that grep's
// scripts/run.ts — this is a no-op at runtime.
void UafError;
