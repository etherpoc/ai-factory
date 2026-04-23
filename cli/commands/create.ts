/**
 * `uaf create` — generate a new project from a natural-language request.
 *
 * Phase 7.3 implementation. Phase 7.8 added the spec → roadmap → build flow
 * (default) on top of the legacy direct-to-orchestrator flow (kept under
 * `--no-spec`).
 *
 *   - loads the merged effective config (`cli/config/loader.ts`)
 *   - budget tracker throws `UafError(BUDGET_EXCEEDED)` (→ exit 5)
 *   - missing API key throws `UafError(API_KEY_MISSING)` (→ exit 6)
 *   - orchestrator halts throw `UafError(CIRCUIT_BREAKER_TRIPPED)` (→ exit 5)
 *   - empty request falls into the wizard
 *
 * Phase 7.8 default flow:
 *   1. classify → load recipe → create workspace (CLI does this now)
 *   2. spec phase  → interviewer agent writes spec.md, checkpoint
 *   3. roadmap phase → roadmap-builder writes roadmap.md, checkpoint
 *   4. user-approval gate (skip with --yes)
 *   5. build phase  → existing runOrchestrator (uses workspace + spec.md)
 *   6. mark all roadmap tasks completed, phase='complete', resumable=false
 *
 * Use `--no-spec` to bypass steps 2-4 and go straight to the legacy flow.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger, nullLogger } from '../../core/logger.js';
import { classify } from '../../core/classifier.js';
import { loadRecipe } from '../../core/recipe-loader.js';
import { createWorkspace } from '../../core/workspace-manager.js';
import { makeProjectId } from '../../core/orchestrator.js';
import { MetricsRecorder } from '../../core/metrics.js';
import { writeTaskCheckpoint } from '../../core/checkpoint.js';
import { buildRoadmap } from '../../core/roadmap-builder.js';
import {
  clearActiveProject,
  setActiveProject,
} from '../../core/signal-handler.js';
import { runSpecWizard } from '../interactive/spec-wizard.js';
import { loadEffectiveConfig, resolveWorkspaceDir } from '../config/loader.js';
import { UafError } from '../ui/errors.js';
import { upsertWorkspaceState } from '../utils/workspace.js';
import { createProgressReporter } from '../ui/progress.js';
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
  // ---- Phase 7.8: spec / roadmap flow ------------------------------------
  /**
   * --no-spec: bypass the spec/roadmap dialogue and go straight to the
   * legacy flow (orchestrator runs without interviewer or roadmap-builder).
   * Commander inverts this: `spec: false` when the user passed --no-spec.
   */
  spec?: boolean;
  /** --spec-file <path>: skip the dialogue, use this spec.md verbatim. */
  specFile?: string;
  /** --yes / -y: skip the post-roadmap approval prompt. */
  yes?: boolean;
}

export interface CreateGlobalOpts {
  verbose?: boolean;
  /** --log-stream: also mirror pino logs to stderr (Phase 7.8.10). */
  logStream?: boolean;
}

export async function runCreate(
  opts: CreateOptions,
  global: CreateGlobalOpts = {},
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

  // Phase 7.8.10: defer pino logger creation until we know the workspace
  // dir (so logs land in workspace/<pid>/logs/create.log). Bootstrap work
  // (classify, loadRecipe, makeProjectId, createWorkspace) uses nullLogger
  // for structured logs; user-facing output goes through the progress reporter.
  const progress = createProgressReporter();
  const { createClaudeStrategy } = await import('../../core/strategies/claude.js');
  const { runOrchestrator } = await import('../../core/orchestrator.js');

  // Phase 7.8: by default we do the new spec→roadmap→build flow; --no-spec
  // (commander stores as `spec: false`) drops back to the legacy single-call
  // path. --spec-file <path> uses the new flow but skips the dialogue.
  const useSpecFlow = opts.spec !== false;

  const start = Date.now();
  let reportOk = false;
  let workspaceDir: string | undefined;
  let projectId: string | undefined;
  let haltReason: string | undefined;
  let doneFlag = false;
  let overall = 0;
  let runErr: unknown;
  let workspaceHandle: import('../../core/types.js').WorkspaceHandle | undefined;
  let usedSpecFlow = false;
  let logger: import('../../core/types.js').Logger = nullLogger;
  const toolStats = { total: 0, byTool: new Map<string, { calls: number; fails: number }>() };

  try {
    if (useSpecFlow) {
      // ---- 5a. New flow: create workspace, wire file-routed logger, then run.
      usedSpecFlow = true;
      progress.info(
        `recipe: ${opts.recipe ?? '(classifier)'} / budget: $${budgetUsd}${
          explicitModel ? ` / model: ${explicitModel}` : ''
        }`,
      );
      const projType = opts.recipe ?? (await classify(opts.request)).type;
      const recipeObj = await loadRecipe(projType, { repoRoot });
      const pid = makeProjectId(opts.request);
      workspaceHandle = await createWorkspace({
        projectId: pid,
        repoRoot,
        logger: nullLogger,
      });
      workspaceDir = workspaceHandle.dir;
      projectId = pid;

      // Now that the workspace dir exists, stand up the real logger. Without
      // --log-stream, logs only land in the file; with it, they also mirror
      // to stderr as JSON (handy for live debugging).
      logger = createLogger({
        name: 'uaf.create',
        filePath: join(workspaceDir, 'logs', 'create.log'),
        ...(global.logStream ? { streamToConsole: true } : {}),
      });
      logger.info('starting run', {
        request: opts.request,
        recipe: recipeObj.meta.type,
        maxIter,
        budgetUsd,
        assetBudgetUsd,
        noAssets,
        skipCritic,
        model: explicitModel ?? '(per-role defaults)',
        workspaceDir,
      });

      // Strategy + budget tracker (created here so they capture the
      // file-routed logger, not the nullLogger).
      const tracker = new BudgetTracker(budgetUsd, logger);
      const firstRoundLogged = new Set<string>();
      const claude = createClaudeStrategy({
        ...(explicitModel !== undefined ? { model: explicitModel } : {}),
        ...(cfg.models ? { modelsByRole: cfg.models as Record<string, string> } : {}),
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
      const assetGenerator = await buildAssetGeneratorOrNull({
        noAssets,
        assetBudgetUsd,
        logger,
      });

      // Register for SIGINT before any LLM work starts.
      setActiveProject({ projectId: pid, workspaceDir: workspaceDir });

      const metrics = new MetricsRecorder({ projectId: pid, dir: workspaceDir, logger });
      const recipeType = recipeObj.meta.type;

      // Initial state.json — phase='spec', resumable from the very start.
      await upsertWorkspaceState(workspaceDir, {
        projectId: pid,
        recipeType,
        originalRequest: opts.request,
        status: 'in-progress',
        phase: 'spec',
        resumable: true,
      });

      // ---- Spec phase
      progress.phase('仕様を詰めていきます', '📋');
      const specResult = await runSpecWizard({
        request: opts.request,
        workspaceDir: workspaceDir,
        projectId: pid,
        recipe: recipeObj,
        strategy,
        metrics,
        repoRoot,
        ...(opts.specFile ? { specFile: opts.specFile } : {}),
        ...(opts.yes ? { autoApprove: true } : {}),
        logger,
      });
      progress.step(`✓ 仕様書を作成しました (${specResult.specPath})`);
      await upsertWorkspaceState(workspaceDir, {
        projectId: pid,
        recipeType,
        originalRequest: opts.request,
        status: 'in-progress',
        phase: 'roadmap',
        resumable: true,
        spec: {
          path: 'spec.md',
          createdAt: new Date().toISOString(),
          dialogTurns: specResult.dialogTurns,
          userApproved: specResult.userApproved,
        },
        lastCheckpointAt: new Date().toISOString(),
      });

      // ---- Roadmap phase
      progress.phase('ロードマップを作成中', '📋');
      const roadmapResult = await buildRoadmap({
        workspaceDir: workspaceDir,
        projectId: pid,
        request: opts.request,
        recipe: recipeObj,
        strategy,
        metrics,
        repoRoot,
        logger,
      });
      await upsertWorkspaceState(workspaceDir, {
        projectId: pid,
        recipeType,
        originalRequest: opts.request,
        status: 'in-progress',
        phase: 'build',
        resumable: true,
        roadmap: roadmapResult.roadmap,
        lastCheckpointAt: new Date().toISOString(),
      });
      progress.step(
        `✓ ${roadmapResult.roadmap.totalTasks} タスクに分解しました (${roadmapResult.markdownPath})`,
      );

      // ---- Build phase: existing orchestrator with externally-managed workspace.
      progress.phase('実装を開始します', '🔨');
      const buildTask = progress.taskStart(1, 1, 'build phase (orchestrator)');
      const report = await runOrchestrator({
        request: opts.request,
        typeHint: recipeType,
        repoRoot,
        logger,
        strategy,
        maxIterations: maxIter,
        keepWorkspace: !opts.cleanup,
        existingWorkspace: workspaceHandle,
        ...(assetGenerator ? { assetGenerator } : {}),
        ...(noAssets ? { noAssets: true } : {}),
        ...(skipCritic ? { skipCritic: true } : {}),
        assetBudgetUsd,
      });
      haltReason = report.haltReason;
      doneFlag = report.completion.done;
      overall = report.completion.overall;
      reportOk = true;
      if (doneFlag) {
        buildTask.complete({ note: `overall ${overall}` });
      } else {
        buildTask.fail(haltReason ?? `done=false (overall ${overall})`);
      }

      // Phase 7.8: mark every roadmap task completed when the build phase
      // finishes successfully. The orchestrator doesn't yet emit per-task
      // signals, so we approximate at the boundary. If the build halted,
      // leave tasks in their pending state so `uaf resume` can retry.
      if (doneFlag) {
        for (const task of roadmapResult.roadmap.tasks) {
          await writeTaskCheckpoint(workspaceDir, {
            taskId: task.id,
            status: 'completed',
          });
        }
      }
    } else {
      // ---- 5b. Legacy flow (kept intact under --no-spec).
      // Uses the traditional stderr-pretty logger because the workspace is
      // created inside runOrchestrator and we don't have its path yet.
      logger = createLogger({ name: 'uaf.create' });
      logger.info('starting run (legacy --no-spec)', {
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
      const tracker = new BudgetTracker(budgetUsd, logger);
      const claude = createClaudeStrategy({
        ...(explicitModel !== undefined ? { model: explicitModel } : {}),
        ...(cfg.models ? { modelsByRole: cfg.models as Record<string, string> } : {}),
        logger,
      });
      const strategy = budgetedStrategy(claude, tracker);
      const assetGenerator = await buildAssetGeneratorOrNull({
        noAssets,
        assetBudgetUsd,
        logger,
      });
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
    }
  } catch (err) {
    runErr = err;
    logger.error('run threw', { error: err instanceof Error ? err.message : String(err) });
  } finally {
    clearActiveProject();
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
      // Phase 7.8: mirror status into the new `phase` field for the
      // spec-flow path so `uaf list --incomplete` / `uaf resume` see a
      // terminal value. Legacy flow stays without `phase`.
      const phase: import('../../core/state.js').Phase | undefined = usedSpecFlow
        ? runErr
          ? 'failed'
          : haltReason
            ? 'failed'
            : doneFlag
              ? 'complete'
              : 'failed'
        : undefined;
      const resumable = usedSpecFlow ? phase !== 'complete' : undefined;
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
        ...(phase !== undefined ? { phase } : {}),
        ...(resumable !== undefined ? { resumable } : {}),
        ...(usedSpecFlow ? { lastCheckpointAt: new Date().toISOString() } : {}),
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
