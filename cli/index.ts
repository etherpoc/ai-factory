/**
 * uaf CLI — command router.
 *
 * Phase 7.1 scaffolds all 10 commands with stubs. Real implementations land in
 * 7.3 and 7.5. Keep this file import-light so startup stays snappy: each
 * command handler `await import(...)`s its module on demand.
 *
 * Legacy scripts/run.ts and scripts/add-recipe.ts remain as thin wrappers that
 * route into cli/commands/{create,add-recipe}.ts (Phase 7.3).
 */
// Load .env early so every command (not just create/add-recipe) sees
// ANTHROPIC_API_KEY and friends. Imported unconditionally — dotenv never
// overwrites pre-existing env vars.
import 'dotenv/config';
import { Command, Option } from 'commander';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCliLogger } from './ui/logger.js';
import { printError } from './ui/errors.js';
import { EXIT_CODES, exitCodeFor } from './ui/exit-codes.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(HERE, '..');

async function readVersion(): Promise<string> {
  try {
    const raw = await readFile(join(PKG_ROOT, 'package.json'), 'utf8');
    const pkg = JSON.parse(raw) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * Shared top-level flags. Attached via `--verbose` / `--help`. We use
 * commander's `opts()` accessor inside each action rather than closing over a
 * mutable global.
 */
interface GlobalOpts {
  verbose?: boolean;
}

function readGlobalOpts(cmd: Command): GlobalOpts {
  // Walk up to the root so subcommands inherit --verbose.
  let current: Command | null = cmd;
  while (current && current.parent) current = current.parent;
  return (current?.opts() ?? {}) as GlobalOpts;
}

async function buildProgram(): Promise<Command> {
  const program = new Command();
  const version = await readVersion();

  program
    .name('uaf')
    .description(
      'Universal Agent Factory — turn a natural-language request into a runnable project.',
    )
    .version(version, '-V, --version', 'show the uaf version')
    .addOption(new Option('--verbose', 'show detailed logs and full stack traces').default(false))
    // When the user runs bare `uaf`, fall into the interactive wizard instead
    // of printing help. `uaf --help` still works because commander parses the
    // help flag before running the action.
    .action(async () => {
      const { runWizard } = await import('./interactive/wizard.js');
      await runWizard();
    });

  // ---- create ------------------------------------------------------------
  program
    .command('create')
    .description('Generate a new project from a natural-language request.')
    .argument('[request...]', 'the request (quoted or positional words)')
    .option('--recipe <type>', 'skip classifier and force this recipe type')
    .option('--budget-usd <usd>', 'halt strategy when cumulative cost exceeds this')
    .option('--max-iterations <n>', 'orchestrator loop cap')
    .option('--max-rounds <n>', 'tool-use round cap per agent')
    .option('--model <id>', 'force a specific model for all roles (default: per-role)')
    .option('--cleanup', 'remove the workspace after completion')
    // Phase 11.a: creative-agent knobs
    .option(
      '--asset-budget-usd <usd>',
      'max USD to spend on external asset providers (Replicate, ElevenLabs). 0 = disable',
    )
    .option('--no-assets', 'skip artist + sound agents (keeps writer + critic if declared)')
    .option('--skip-critic', 'skip the critic agent')
    .action(async (request: string[], opts, cmd: Command) => {
      const joined = request.join(' ').trim();
      if (!joined) {
        const { runCreateWizard } = await import('./interactive/wizard.js');
        await runCreateWizard();
        return;
      }
      const { runCreate } = await import('./commands/create.js');
      await runCreate({ request: joined, ...opts }, readGlobalOpts(cmd));
    });

  // ---- add-recipe --------------------------------------------------------
  program
    .command('add-recipe')
    .description('Generate a new recipe type via the recipe-builder meta agent.')
    .option('--type <type>', 'new recipe type slug (kebab-case)')
    .option('--description <text>', 'short description shown in `uaf recipes`')
    .option('--reference <type>', 'existing recipe type to use as a reference')
    .option('--budget-usd <usd>', 'budget cap for recipe-builder')
    .option('--max-rounds <n>', 'tool-use round cap')
    .action(async (opts, cmd: Command) => {
      if (!opts.type || !opts.description) {
        const { runAddRecipeWizard } = await import('./interactive/wizard.js');
        await runAddRecipeWizard();
        return;
      }
      const { runAddRecipe } = await import('./commands/add-recipe.js');
      await runAddRecipe(opts, readGlobalOpts(cmd));
    });

  // ---- iterate -----------------------------------------------------------
  // Note: a request containing dashes (e.g. "add --version flag") collides
  // with commander's option parser. Use the UNIX `--` separator:
  //
  //   uaf iterate <pid> --dry-run -- "add --version flag"
  //
  // Plain requests like "add a counter feature" do not need the separator.
  program
    .command('iterate')
    .description('Add a diff on top of an existing project (differential re-run). Use `-- "…"` when the request contains --flags.')
    .argument('<proj-id>', 'project id in workspace/<proj-id>/')
    .argument('[request...]', 'what to change (prefix with -- if it contains dashes)')
    .option('--budget-usd <usd>', 'budget cap')
    .option('--max-iterations <n>', 'orchestrator loop cap')
    .option('--max-rounds <n>', 'tool-use round cap')
    .option('--dry-run', 'show what would be changed without calling the LLM')
    .action(async (projId: string, request: string[], opts, cmd: Command) => {
      const { runIterate } = await import('./commands/iterate.js');
      await runIterate(
        { projectId: projId, request: request.join(' ').trim(), ...opts },
        readGlobalOpts(cmd),
      );
    });

  // ---- list --------------------------------------------------------------
  program
    .command('list')
    .description('List generated projects.')
    .option('--recipe <type>', 'filter by recipe type')
    .option('--status <status>', 'filter by status (done|halted|failed)')
    .option('--json', 'emit JSON instead of a human table')
    .action(async (opts, cmd: Command) => {
      const { runList } = await import('./commands/list.js');
      await runList(opts, readGlobalOpts(cmd));
    });

  // ---- open --------------------------------------------------------------
  program
    .command('open')
    .description('Open a project workspace in an editor or browser.')
    .argument('<proj-id>', 'project id')
    .option('--editor <cmd>', 'editor command (overrides config)')
    .option('--browser', 'open in default browser (for web projects)')
    .action(async (projId: string, opts, cmd: Command) => {
      const { runOpen } = await import('./commands/open.js');
      await runOpen({ projectId: projId, ...opts }, readGlobalOpts(cmd));
    });

  // ---- recipes -----------------------------------------------------------
  program
    .command('recipes')
    .description('List available recipe types.')
    .option('--json', 'emit JSON')
    .action(async (opts, cmd: Command) => {
      const { runRecipes } = await import('./commands/recipes.js');
      await runRecipes(opts, readGlobalOpts(cmd));
    });

  // ---- cost --------------------------------------------------------------
  program
    .command('cost')
    .description('Aggregate cost from workspace metrics.')
    .option('--period <period>', 'today | week | month | all', 'all')
    .option('--json', 'emit JSON')
    .action(async (opts, cmd: Command) => {
      const { runCost } = await import('./commands/cost.js');
      await runCost(opts, readGlobalOpts(cmd));
    });

  // ---- clean -------------------------------------------------------------
  program
    .command('clean')
    .description('Remove old workspaces.')
    .option('--older-than <duration>', 'e.g. 7d, 2w, 1m', '30d')
    .option('--dry-run', 'show what would be deleted')
    .option('-y, --yes', 'skip confirmation prompt')
    .action(async (opts, cmd: Command) => {
      const { runClean } = await import('./commands/clean.js');
      await runClean(opts, readGlobalOpts(cmd));
    });

  // ---- config ------------------------------------------------------------
  const configCmd = program
    .command('config')
    .description('Read or write uaf configuration.');
  configCmd
    .command('get <key>')
    .description('Print the effective value of a config key.')
    .option('--global', 'read only from ~/.uaf/config.yaml')
    .option('--project', 'read only from ./.uafrc')
    .action(async (key: string, opts, cmd: Command) => {
      const { runConfigGet } = await import('./commands/config.js');
      await runConfigGet({ key, ...opts }, readGlobalOpts(cmd));
    });
  configCmd
    .command('set <key> <value>')
    .description('Write a config key.')
    .option('--global', 'write to ~/.uaf/config.yaml (default)')
    .option('--project', 'write to ./.uafrc')
    .action(async (key: string, value: string, opts, cmd: Command) => {
      const { runConfigSet } = await import('./commands/config.js');
      await runConfigSet({ key, value, ...opts }, readGlobalOpts(cmd));
    });
  configCmd
    .command('list')
    .description('Print the effective merged config.')
    .option('--json', 'emit JSON')
    .action(async (opts, cmd: Command) => {
      const { runConfigList } = await import('./commands/config.js');
      await runConfigList(opts, readGlobalOpts(cmd));
    });
  configCmd
    .command('edit')
    .description('Open a config file in $EDITOR.')
    .option('--global', 'edit ~/.uaf/config.yaml (default)')
    .option('--project', 'edit ./.uafrc')
    .action(async (opts, cmd: Command) => {
      const { runConfigEdit } = await import('./commands/config.js');
      await runConfigEdit(opts, readGlobalOpts(cmd));
    });

  // ---- doctor ------------------------------------------------------------
  program
    .command('doctor')
    .description('Check the local environment for common issues.')
    .option('--json', 'emit JSON')
    .action(async (opts, cmd: Command) => {
      const { runDoctor } = await import('./commands/doctor.js');
      await runDoctor(opts, readGlobalOpts(cmd));
    });

  return program;
}

/**
 * Top-level entry. Scans argv for `--verbose` ourselves (not just commander's
 * parsed root.opts()) so the flag works identically no matter where it appears
 * on the command line: `uaf --verbose doctor` and `uaf doctor --verbose` both
 * flip verbose mode on.
 */
export async function main(argv: string[]): Promise<number> {
  const program = await buildProgram();
  const logger = createCliLogger({ verbose: argv.includes('--verbose') });

  try {
    await program.parseAsync(argv);
    return EXIT_CODES.SUCCESS;
  } catch (err) {
    printError(err, logger);
    return exitCodeFor(err);
  }
}

// If invoked as the entry module, run. When imported (tests), consumers call
// `main()` themselves.
const invokedDirectly = fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  main(process.argv).then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write('fatal: ' + (err instanceof Error ? err.stack : String(err)) + '\n');
      process.exit(1);
    },
  );
}
