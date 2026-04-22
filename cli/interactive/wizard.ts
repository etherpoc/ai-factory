/**
 * uaf interactive wizard (Phase 7.4).
 *
 *   - `runWizard()` is the top-level entry used by bare `uaf` and by commands
 *     that were invoked without enough arguments. It asks which action to
 *     perform, then dispatches to a task-specific sub-wizard.
 *
 *   - `runCreateWizard()` gathers the minimum needed to call `runCreate()`.
 *   - `runAddRecipeWizard()` does the same for `runAddRecipe()`.
 *
 * Sub-wizards for the remaining commands land with their implementations in
 * Phase 7.5 (e.g. `runIterateWizard`). For now the top-level menu only
 * surfaces actions that can actually run interactively.
 *
 * Every prompter call is threaded through `withAbortHandling` so Ctrl-C turns
 * into a clean `UafError(USER_ABORT)` (→ exit 8). Tests inject a fake
 * `Prompter` via the `deps.prompter` parameter instead of monkey-patching
 * `@inquirer/prompts`.
 */
import { loadEffectiveConfig } from '../config/loader.js';
import { UafError } from '../ui/errors.js';
import {
  defaultPrompter,
  withAbortHandling,
  type Prompter,
} from './prompts.js';

export interface WizardDeps {
  prompter?: Prompter;
  /** Inject the command functions in tests — defaults to dynamic imports. */
  runCreate?: (opts: Record<string, unknown>) => Promise<void>;
  runAddRecipe?: (opts: Record<string, unknown>) => Promise<void>;
}

type TopChoice =
  | 'create'
  | 'add-recipe'
  | 'list'
  | 'recipes'
  | 'cost'
  | 'doctor'
  | 'exit';

const TOP_CHOICES: Array<{ name: string; value: TopChoice; description: string }> = [
  { name: 'プロジェクトを生成する (create)', value: 'create', description: '自然言語から新規プロジェクトを作成' },
  { name: 'レシピを追加する (add-recipe)', value: 'add-recipe', description: '新しい種別のレシピを生成' },
  { name: 'プロジェクト一覧を表示 (list)', value: 'list', description: '生成済みプロジェクトの一覧' },
  { name: 'レシピ一覧を表示 (recipes)', value: 'recipes', description: '利用可能なレシピ種別' },
  { name: '累計コストを表示 (cost)', value: 'cost', description: 'workspace/*/metrics.jsonl から集計' },
  { name: '環境チェック (doctor)', value: 'doctor', description: '依存関係・設定・API キーを確認' },
  { name: '終了', value: 'exit', description: 'ウィザードを抜ける' },
];

async function getPrompter(deps: WizardDeps): Promise<Prompter> {
  return deps.prompter ?? (await defaultPrompter());
}

// ---------------------------------------------------------------------------
// Top-level dispatch
// ---------------------------------------------------------------------------

export async function runWizard(deps: WizardDeps = {}): Promise<void> {
  const prompter = await getPrompter(deps);

  const action = await withAbortHandling(() =>
    prompter.select<TopChoice>({
      message: 'どの操作を行いますか?',
      choices: TOP_CHOICES,
      default: 'create',
    }),
  );

  switch (action) {
    case 'create':
      return runCreateWizard(deps);
    case 'add-recipe':
      return runAddRecipeWizard(deps);
    case 'list':
      return dispatchCommand('list');
    case 'recipes':
      return dispatchCommand('recipes');
    case 'cost':
      return dispatchCommand('cost');
    case 'doctor':
      return dispatchCommand('doctor');
    case 'exit':
      // Quiet no-op — not an error.
      return;
    default: {
      const _exhaustive: never = action;
      throw new UafError(`unhandled wizard choice: ${String(_exhaustive)}`, {
        code: 'RUNTIME_FAILURE',
      });
    }
  }
}

/**
 * Dispatch a top-level action that doesn't need an interactive form. In
 * Phase 7.4 these commands are still stubs, so they throw NOT_IMPLEMENTED;
 * once Phase 7.5 lands they run for real.
 */
async function dispatchCommand(name: 'list' | 'recipes' | 'cost' | 'doctor'): Promise<void> {
  if (name === 'list') {
    const { runList } = await import('../commands/list.js');
    return runList({}, {});
  }
  if (name === 'recipes') {
    const { runRecipes } = await import('../commands/recipes.js');
    return runRecipes({}, {});
  }
  if (name === 'cost') {
    const { runCost } = await import('../commands/cost.js');
    return runCost({}, {});
  }
  const { runDoctor } = await import('../commands/doctor.js');
  return runDoctor({}, {});
}

// ---------------------------------------------------------------------------
// `uaf create` wizard
// ---------------------------------------------------------------------------

export async function runCreateWizard(deps: WizardDeps = {}): Promise<void> {
  const prompter = await getPrompter(deps);
  const { effective: cfg } = await loadEffectiveConfig();

  const request = await withAbortHandling(() =>
    prompter.input({
      message: '何を作りますか? (例: 2Dの避けゲーム)',
      validate: (v) => (v.trim().length > 0 ? true : 'リクエストは必須です'),
    }),
  );

  const recipe = await withAbortHandling(() =>
    prompter.select<string>({
      message: 'レシピ種別を選んでください',
      choices: [
        { name: '自動判定 (classifier)', value: '' },
        { name: '2d-game — Phaser 3 + Vite', value: '2d-game' },
        { name: '3d-game — Three.js + Vite', value: '3d-game' },
        { name: 'web-app — Next.js 14 + Tailwind', value: 'web-app' },
        { name: 'mobile-app — Expo + Jest', value: 'mobile-app' },
        { name: 'desktop-app — Electron + Vite', value: 'desktop-app' },
        { name: 'cli — Node.js + vitest', value: 'cli' },
        { name: 'api — Hono + vitest', value: 'api' },
      ],
      default: '',
    }),
  );

  const budget = await withAbortHandling(() =>
    prompter.number({
      message: '予算 (USD) を設定します',
      default: cfg.budget_usd ?? 2.0,
      min: 0.01,
      max: 100,
      validate: (v) => (v !== undefined && v > 0 ? true : '0 より大きい数値を入力してください'),
    }),
  );

  const maxIter = await withAbortHandling(() =>
    prompter.number({
      message: 'イテレーション上限 (既定のままで OK)',
      default: cfg.max_iterations ?? 3,
      min: 1,
      max: 20,
    }),
  );

  // ---- Dispatch
  const opts: Record<string, unknown> = {
    request,
  };
  if (recipe && recipe !== '') opts.recipe = recipe;
  if (budget !== undefined) opts.budgetUsd = String(budget);
  if (maxIter !== undefined) opts.maxIterations = String(maxIter);

  const run = deps.runCreate ?? (async (o) => {
    const { runCreate } = await import('../commands/create.js');
    await runCreate(o as Parameters<typeof runCreate>[0]);
  });
  await run(opts);
}

// ---------------------------------------------------------------------------
// `uaf add-recipe` wizard
// ---------------------------------------------------------------------------

export async function runAddRecipeWizard(deps: WizardDeps = {}): Promise<void> {
  const prompter = await getPrompter(deps);

  const type = await withAbortHandling(() =>
    prompter.input({
      message: 'レシピ種別名 (kebab-case、例: 3d-game)',
      validate: (v) => {
        const s = v.trim();
        if (s.length === 0) return 'レシピ名は必須です';
        if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(s))
          return 'kebab-case で入力してください (a-z, 0-9, -)';
        return true;
      },
    }),
  );

  const description = await withAbortHandling(() =>
    prompter.input({
      message: 'スタック/目的の説明 (例: Three.js を使った 3D ゲームレシピ)',
      validate: (v) => (v.trim().length > 0 ? true : '説明は必須です'),
    }),
  );

  const useReference = await withAbortHandling(() =>
    prompter.confirm({
      message: '既存レシピを構造的な参照にしますか? (推奨)',
      default: true,
    }),
  );

  let reference: string | undefined;
  if (useReference) {
    reference = await withAbortHandling(() =>
      prompter.select<string>({
        message: '参照する既存レシピを選んでください',
        choices: [
          { name: '2d-game', value: '2d-game' },
          { name: '3d-game', value: '3d-game' },
          { name: 'web-app', value: 'web-app' },
          { name: 'mobile-app', value: 'mobile-app' },
          { name: 'desktop-app', value: 'desktop-app' },
          { name: 'cli', value: 'cli' },
          { name: 'api', value: 'api' },
        ],
      }),
    );
  }

  const opts: Record<string, unknown> = {
    type: type.trim(),
    description: description.trim(),
  };
  if (reference) opts.reference = reference;

  const run = deps.runAddRecipe ?? (async (o) => {
    const { runAddRecipe } = await import('../commands/add-recipe.js');
    await runAddRecipe(o as Parameters<typeof runAddRecipe>[0]);
  });
  await run(opts);
}
