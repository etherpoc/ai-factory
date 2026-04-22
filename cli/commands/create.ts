/**
 * `uaf create` — generate a new project from a natural-language request.
 *
 * Phase 7.3 implementation. Ported from `scripts/run.ts` with the Phase 7
 * ergonomics layered on top:
 *   - loads the merged effective config (`cli/config/loader.ts`)
 *   - budget tracker throws `UafError(BUDGET_EXCEEDED)` (→ exit 5)
 *   - missing API key throws `UafError(API_KEY_MISSING)` (→ exit 6)
 *   - orchestrator halts throw `UafError(CIRCUIT_BREAKER_TRIPPED)` (→ exit 5)
 *   - empty request falls into the wizard (Phase 7.4 — currently stub)
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from '../../core/logger.js';
import { loadEffectiveConfig, resolveWorkspaceDir } from '../config/loader.js';
import { UafError } from '../ui/errors.js';
import { upsertWorkspaceState } from '../utils/workspace.js';
import {
  BudgetTracker,
  budgetedStrategy,
  formatRunSummary,
  summarizeMetrics,
} from './_run-helpers.js';

export interface CreateOptions {
  /** Joined positional arg or --request. */
  request?: string;
  /** Force this recipe type, bypassing the classifier. */
  recipe?: string;
  /** Budget cap in USD (string from commander, parsed here). */
  budgetUsd?: string;
  /** Orchestrator loop cap. */
  maxIterations?: string;
  /** Tool-use round cap. */
  maxRounds?: string;
  /** Force a specific model for every role. */
  model?: string;
  /** Remove the workspace after completion. Default: keep. */
  cleanup?: boolean;
  // ---- Phase 11.a: creative-agent flags ----------------------------------
  /** USD cap for external asset generation. `0` disables artist/sound entirely. */
  assetBudgetUsd?: string;
  /** --no-assets: commander stores this as `assets: false`. */
  assets?: boolean;
  /** --skip-critic */
  skipCritic?: boolean;
}

export interface CreateGlobalOpts {
  verbose?: boolean;
}

export async function runCreate(
  opts: CreateOptions,
  _global: CreateGlobalOpts = {},
): Promise<void> {
  // ---- 1. Defensive precondition: the commander action handler routes empty
  //         requests to the wizard before we ever get here. If we land here
  //         with an empty request it means a programmatic caller forgot to
  //         pass one, which is a bug worth surfacing loudly.
  if (!opts.request || opts.request.trim() === '') {
    throw new UafError('missing request', {
      code: 'ARG_MISSING',
      hint: 'Call `uaf create "<request>"` or use the wizard via bare `uaf`.',
    });
  }

  // ---- 2. Environment preconditions
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new UafError('ANTHROPIC_API_KEY is not set', {
      code: 'API_KEY_MISSING',
      hint: 'Copy .env.example to .env and set your Anthropic API key.',
    });
  }

  // ---- 3. Merge config: --flag > config file > built-in defaults
  const { effective: cfg } = await loadEffectiveConfig();
  const repoRoot = process.cwd();

  const budgetUsd = Math.max(
    0.01,
    opts.budgetUsd !== undefined ? Number.parseFloat(opts.budgetUsd) : cfg.budget_usd ?? 2.0,
  );
  const maxIter = Math.max(
    1,
    opts.maxIterations !== undefined
      ? Number.parseInt(opts.maxIterations, 10)
      : cfg.max_iterations ?? 3,
  );
  const explicitModel = opts.model ?? process.env.UAF_DEFAULT_MODEL;

  // Phase 11.a: creative-agent wiring. `--no-assets` sets opts.assets=false
  // (commander inverts); `--asset-budget-usd 0` drops artist/sound too.
  const noAssets = opts.assets === false;
  const skipCritic = opts.skipCritic === true;
  const assetBudgetUsd =
    opts.assetBudgetUsd !== undefined
      ? Math.max(0, Number.parseFloat(opts.assetBudgetUsd))
      : cfg.assets?.budget_usd ??
        (process.env.DEFAULT_ASSET_BUDGET_USD
          ? Math.max(0, Number.parseFloat(process.env.DEFAULT_ASSET_BUDGET_USD))
          : 2.0);

  const logger = createLogger({ name: 'uaf.create' });
  logger.info('starting run', {
    request: opts.request,
    recipe: opts.recipe ?? '(classifier)',
    maxIter,
    budgetUsd,
    assetBudgetUsd,
    noAssets,
    skipCritic,
    model: explicitModel ?? '(per-role defaults)',
    workspaceBase: resolveWorkspaceDir(cfg, repoRoot),
  });

  // ---- 4. Strategy + budget tracker (Sonnet cache-friendly via extras)
  const { createClaudeStrategy } = await import('../../core/strategies/claude.js');
  const { runOrchestrator } = await import('../../core/orchestrator.js');

  const tracker = new BudgetTracker(budgetUsd, logger);
  const toolStats = { total: 0, byTool: new Map<string, { calls: number; fails: number }>() };
  const firstRoundLogged = new Set<string>();
  const claude = createClaudeStrategy({
    ...(explicitModel !== undefined ? { model: explicitModel } : {}),
    ...(cfg.models
      ? { modelsByRole: cfg.models as Record<string, string> }
      : {}),
    logger,
    onRawUsage: (ev) => {
      const key = `${ev.role}:${ev.round}`;
      if (firstRoundLogged.has(key)) return;
      firstRoundLogged.add(key);
      logger.info('raw.usage', {
        role: ev.role,
        round: ev.round,
        model: ev.model,
        stopReason: ev.stopReason,
        usage: ev.usage,
      });
    },
    onToolCall: (ev) => {
      toolStats.total += 1;
      const b = toolStats.byTool.get(ev.tool) ?? { calls: 0, fails: 0 };
      b.calls += 1;
      if (!ev.ok) b.fails += 1;
      toolStats.byTool.set(ev.tool, b);
      logger.info('tool.call', {
        role: ev.role,
        tool: ev.tool,
        ok: ev.ok,
        durationMs: ev.durationMs,
        args: ev.argsSummary,
        ...(ev.errorSummary ? { error: ev.errorSummary } : {}),
      });
    },
  });
  const strategy = budgetedStrategy(claude, tracker);

  // Phase 11.a: build the AssetGenerator only when we might need it. This
  // keeps `uaf create --no-assets` from requiring REPLICATE/ELEVENLABS keys.
  const assetGenerator = await buildAssetGeneratorOrNull({
    noAssets,
    assetBudgetUsd,
    logger,
  });

  // ---- 5. Run
  const start = Date.now();
  let reportOk = false;
  let workspaceDir: string | undefined;
  let projectId: string | undefined;
  let haltReason: string | undefined;
  let doneFlag = false;
  let overall = 0;
  let runErr: unknown;

  try {
    const report = await runOrchestrator({
      request: opts.request,
      ...(opts.recipe !== undefined ? { typeHint: opts.recipe } : {}),
      repoRoot,
      logger,
      strategy,
      maxIterations: maxIter,
      keepWorkspace: !opts.cleanup,
      ...(assetGenerator ? { assetGenerator } : {}),
      ...(noAssets ? { noAssets: true } : {}),
      ...(skipCritic ? { skipCritic: true } : {}),
      assetBudgetUsd,
    });
    workspaceDir = report.workspaceDir;
    projectId = report.projectId;
    haltReason = report.haltReason;
    doneFlag = report.completion.done;
    overall = report.completion.overall;
    reportOk = true;
  } catch (err) {
    runErr = err;
    logger.error('run threw', { error: err instanceof Error ? err.message : String(err) });
  }

  const elapsedSec = Math.round((Date.now() - start) / 1000);

  // ---- 6. Summary (stdout)
  const metricsPath = workspaceDir ? join(workspaceDir, 'metrics.jsonl') : undefined;
  const summary = metricsPath
    ? await summarizeMetrics(metricsPath, explicitModel ?? 'claude-sonnet-4-6')
    : undefined;

  const text = formatRunSummary({
    request: opts.request,
    recipe: opts.recipe ?? '(classifier)',
    ...(projectId !== undefined ? { projectId } : {}),
    ...(workspaceDir !== undefined ? { workspaceDir } : {}),
    ...(metricsPath !== undefined ? { metricsPath } : {}),
    elapsedSec,
    reportOk,
    ...(haltReason !== undefined ? { haltReason } : {}),
    doneFlag,
    overall,
    toolStats,
    ...(summary !== undefined ? { summary } : {}),
    budgetUsd,
  });

  process.stdout.write(text);

  // Persist summary + state.json alongside the workspace so `uaf list`,
  // `uaf iterate`, and `uaf open` can pick it up. Non-fatal on failure.
  if (workspaceDir && projectId) {
    try {
      await writeFile(join(workspaceDir, 'RUN_SUMMARY.txt'), text, 'utf8');
    } catch {
      /* non-fatal */
    }
    try {
      const recipeType = opts.recipe ?? '(classifier)';
      const status: 'completed' | 'halted' | 'failed' = runErr
        ? 'failed'
        : haltReason
          ? 'halted'
          : doneFlag
            ? 'completed'
            : 'halted';
      // Phase 11.a: summarize creative-agent outputs by inspecting the
      // files the artist/sound/writer/critic agents dropped into the
      // workspace. This is cheap (a few stat + parses) and populates
      // state.json.assets so `uaf list` / `uaf cost` can show them.
      const assetsSummary = await scanCreativeOutputs(workspaceDir).catch(() => undefined);
      await upsertWorkspaceState(workspaceDir, {
        projectId,
        recipeType,
        originalRequest: opts.request,
        status,
        entry: {
          ts: new Date().toISOString(),
          mode: 'create',
          request: opts.request,
          ...(summary ? { costUsd: +summary.totalUsd.toFixed(4) } : {}),
          done: doneFlag,
          overall,
          ...(haltReason ? { haltReason } : {}),
        },
        ...(assetsSummary ? { assets: assetsSummary } : {}),
      });
    } catch {
      /* non-fatal — state.json is a convenience, not a correctness requirement */
    }
    process.stdout.write(`REPORT.md     : ${join(workspaceDir, 'REPORT.md')}\n\n`);
  }

  // ---- 7. Exit code contract
  if (runErr) {
    // Propagate our own errors (BUDGET_EXCEEDED, API_KEY_MISSING) with their
    // original code. Anything else becomes a generic runtime failure so the
    // CI can detect it (exit 5).
    if (runErr instanceof UafError) throw runErr;
    throw new UafError(runErr instanceof Error ? runErr.message : String(runErr), {
      code: 'RUNTIME_FAILURE',
      cause: runErr,
      details: { workspace: workspaceDir, budgetUsd, totalUsd: summary?.totalUsd },
      logPath: metricsPath,
    });
  }

  if (haltReason) {
    throw new UafError(`run halted: ${haltReason}`, {
      code: 'CIRCUIT_BREAKER_TRIPPED',
      details: { projectId, workspaceDir, overall, doneFlag },
      hint: 'Check the REPORT.md in the workspace for the last sprint error chain.',
      ...(metricsPath ? { logPath: metricsPath } : {}),
    });
  }

  if (!doneFlag) {
    throw new UafError('run finished without reaching done=true', {
      code: 'RUNTIME_FAILURE',
      details: { projectId, workspaceDir, overall },
      hint: 'Try --max-iterations 5 or tighten the request.',
      ...(metricsPath ? { logPath: metricsPath } : {}),
    });
  }
}

// ===========================================================================
// Phase 11.a helpers
// ===========================================================================

/**
 * Build an AssetGenerator if creative agents are likely to run. Returns null
 * when the user opted out (--no-assets / budget 0) or when the required env
 * vars are missing. Orchestrator will then skip artist/sound automatically.
 *
 * Uses top-level dynamic imports (ESM-safe; the package is `"type": "module"`).
 */
async function buildAssetGeneratorOrNull(args: {
  noAssets: boolean;
  assetBudgetUsd: number;
  logger: ReturnType<typeof createLogger>;
}): Promise<import('../../core/asset-generator.js').AssetGenerator | null> {
  if (args.noAssets || args.assetBudgetUsd === 0) return null;

  const repToken = process.env.REPLICATE_API_TOKEN;
  const elKey = process.env.ELEVENLABS_API_KEY;

  if (!repToken && !elKey) {
    args.logger.info('asset generator not built: no external provider credentials', {});
    return null;
  }

  const imageProviders: import('../../core/providers/types.js').ImageProvider[] = [];
  const audioProviders: import('../../core/providers/types.js').AudioProvider[] = [];

  if (repToken) {
    const { createReplicateProvider } = await import('../../core/providers/image/replicate.js');
    imageProviders.push(createReplicateProvider({ apiToken: repToken }));
  }
  if (elKey) {
    const { createElevenLabsProvider } = await import('../../core/providers/audio/elevenlabs.js');
    audioProviders.push(createElevenLabsProvider({ apiKey: elKey }));
  }

  const [{ createImageProviderRegistry }, { createAudioProviderRegistry }, { createAssetGenerator }] = await Promise.all([
    import('../../core/providers/image/index.js'),
    import('../../core/providers/audio/index.js'),
    import('../../core/asset-generator.js'),
  ]);

  return createAssetGenerator({
    imageProviders: createImageProviderRegistry(imageProviders),
    audioProviders: createAudioProviderRegistry(audioProviders),
    assetBudgetUsd: args.assetBudgetUsd,
    logger: args.logger,
  });
}

/**
 * Look at the well-known creative outputs in the workspace and return a
 * compact summary for state.json.assets. All fields best-effort — missing
 * files are silently skipped.
 */
async function scanCreativeOutputs(
  workspaceDir: string,
): Promise<import('../utils/workspace.js').UpsertStateInput['assets']> {
  const { readFile, readdir, stat } = await import('node:fs/promises');
  const { join: pjoin } = await import('node:path');
  const out: import('../utils/workspace.js').UpsertStateInput['assets'] = {};

  // Images
  try {
    const raw = await readFile(pjoin(workspaceDir, 'assets-manifest.json'), 'utf8');
    const m = JSON.parse(raw) as {
      assets?: Array<{ costUsd?: number }>;
      totalCostUsd?: number;
    };
    const count = Array.isArray(m.assets) ? m.assets.length : 0;
    const totalCostUsd = typeof m.totalCostUsd === 'number' ? m.totalCostUsd : 0;
    out.images = { count, totalCostUsd, manifestPath: 'assets-manifest.json' };
  } catch {
    // Fallback: count the files in assets/images/
    try {
      const entries = await readdir(pjoin(workspaceDir, 'assets', 'images'));
      if (entries.length > 0) {
        out.images = { count: entries.length, totalCostUsd: 0 };
      }
    } catch {
      // no images
    }
  }

  // Audio
  try {
    const raw = await readFile(pjoin(workspaceDir, 'audio-manifest.json'), 'utf8');
    const m = JSON.parse(raw) as {
      bgm?: unknown[];
      sfx?: unknown[];
      totalCostUsd?: number;
    };
    const count = (Array.isArray(m.bgm) ? m.bgm.length : 0) + (Array.isArray(m.sfx) ? m.sfx.length : 0);
    const totalCostUsd = typeof m.totalCostUsd === 'number' ? m.totalCostUsd : 0;
    out.audio = { count, totalCostUsd, manifestPath: 'audio-manifest.json' };
  } catch {
    try {
      const entries = await readdir(pjoin(workspaceDir, 'assets', 'audio'));
      if (entries.length > 0) out.audio = { count: entries.length, totalCostUsd: 0 };
    } catch {
      // no audio
    }
  }

  // Copy
  try {
    const raw = await readFile(pjoin(workspaceDir, 'copy.json'), 'utf8');
    const parsed = JSON.parse(raw) as { strings?: Record<string, unknown> };
    const keys = parsed.strings ? Object.keys(parsed.strings).length : undefined;
    out.copy = { path: 'copy.json', ...(keys !== undefined ? { keys } : {}) };
  } catch {
    // no copy
  }

  // Critique — extract overall score from the markdown
  try {
    const raw = await readFile(pjoin(workspaceDir, 'critique.md'), 'utf8');
    const m = /総合スコア[:： ]+(\d+(?:\.\d+)?)/i.exec(raw) ?? /overall score[:： ]+(\d+(?:\.\d+)?)/i.exec(raw);
    out.critique = {
      path: 'critique.md',
      ...(m ? { overallScore: Number.parseFloat(m[1]!) } : {}),
    };
  } catch {
    // no critique
  }

  // `await stat` is imported but unused above — keep it to avoid linter churn
  // if we later want to verify file existence without parsing.
  void stat;

  // If everything is empty, return undefined so the caller can omit the key.
  if (!out.images && !out.audio && !out.copy && !out.critique) return undefined;
  return out;
}
