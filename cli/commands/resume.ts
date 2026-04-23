/**
 * `uaf resume <proj-id>` (Phase 7.8.5).
 *
 * Loads state.json, decides via `planResume()` what to do, prompts the user
 * for confirmation, then re-invokes the same machinery the create command
 * uses. The orchestrator's `existingWorkspace` + `skipScaffold` + spec/design
 * existence checks make the build phase idempotent enough to run again
 * without redoing completed work.
 */
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { createLogger } from '../../core/logger.js';
import { createProgressReporter } from '../ui/progress.js';
import { MetricsRecorder } from '../../core/metrics.js';
import { buildRoadmap } from '../../core/roadmap-builder.js';
import { loadRecipe } from '../../core/recipe-loader.js';
import {
  formatProgressLine,
  planResume,
  surveyWorkspaceFiles,
} from '../../core/resume.js';
import {
  clearActiveProject,
  setActiveProject,
} from '../../core/signal-handler.js';
import { writeTaskCheckpoint } from '../../core/checkpoint.js';
import { upsertWorkspaceState } from '../../core/state.js';
import type { WorkspaceHandle } from '../../core/types.js';
import { runSpecWizard } from '../interactive/spec-wizard.js';
import {
  defaultPrompter,
  withAbortHandling,
  type Prompter,
} from '../interactive/prompts.js';
import { loadEffectiveConfig, resolveWorkspaceDir } from '../config/loader.js';
import { colors } from '../ui/colors.js';
import { UafError } from '../ui/errors.js';
import { findProject } from '../utils/workspace.js';
import {
  BudgetTracker,
  budgetedStrategy,
  formatRunSummary,
  summarizeMetrics,
} from './_run-helpers.js';

export interface ResumeOptions {
  projectId: string;
  /** -y / --yes: skip the "continue?" prompt. */
  yes?: boolean;
  /** Override budget for this resume. */
  budgetUsd?: string;
  /** Override iteration cap for this resume. */
  maxIterations?: string;
  /** Force a model. */
  model?: string;
  // Phase 11.a flags — reused from create.
  assetBudgetUsd?: string;
  assets?: boolean;
  skipCritic?: boolean;
}

export interface ResumeGlobalOpts {
  verbose?: boolean;
  /** --log-stream: also mirror pino logs to stderr (Phase 7.8.10). */
  logStream?: boolean;
}

export async function runResume(
  opts: ResumeOptions,
  global: ResumeGlobalOpts = {},
  /** Optional injection for tests. */
  injected?: { prompter?: Prompter },
): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new UafError('ANTHROPIC_API_KEY is not set', {
      code: 'API_KEY_MISSING',
      hint: 'Copy .env.example to .env and set your Anthropic API key.',
    });
  }

  const { effective: cfg } = await loadEffectiveConfig();
  const workspaceBase = resolveWorkspaceDir(cfg, process.cwd());
  const repoRoot = process.cwd();
  const project = await findProject(workspaceBase, opts.projectId);

  const files = await surveyWorkspaceFiles(project.dir);
  const plan = planResume({ state: project.state, files });

  // Show context up-front so the user can decide.
  process.stdout.write(colors.bold(`=== uaf resume — ${project.projectId} ===`) + '\n');
  if (project.state) {
    process.stdout.write(`Recipe   : ${project.state.recipeType}\n`);
    process.stdout.write(`Request  : ${truncate(project.state.originalRequest, 80)}\n`);
    process.stdout.write(`Progress : ${formatProgressLine(project.state)}\n`);
    process.stdout.write(
      `Last run : ${project.state.lastRunAt} (${formatAge(project.state.lastRunAt)} ago)\n`,
    );
  }
  for (const w of plan.warnings) {
    process.stderr.write(colors.yellow(`! ${w}\n`));
  }

  switch (plan.action.kind) {
    case 'not-resumable':
      throw new UafError(`cannot resume: ${plan.action.reason}`, {
        code: 'RUNTIME_FAILURE',
        hint: 'Run `uaf list --incomplete` to see resumable projects.',
      });
    case 'already-complete':
      process.stdout.write(colors.green('Already complete — nothing to do.\n'));
      return;
    case 'rerun-spec':
      process.stdout.write(colors.dim('Action   : re-run spec phase\n'));
      break;
    case 'rerun-roadmap':
      process.stdout.write(colors.dim('Action   : re-run roadmap phase\n'));
      break;
    case 'continue-build':
      process.stdout.write(
        colors.dim(
          `Action   : continue build phase${
            plan.action.nextTaskId ? ` (next: ${plan.action.nextTaskId})` : ''
          }\n`,
        ),
      );
      break;
  }

  if (!opts.yes) {
    const prompter = injected?.prompter ?? (await defaultPrompter());
    const proceed = await withAbortHandling(() =>
      prompter.confirm({
        message: '続行しますか?',
        default: true,
      }),
    );
    if (!proceed) {
      throw new UafError('aborted by user', {
        code: 'USER_ABORT',
      });
    }
  }

  // ---- Build the strategy + budget tracker (same shape as runCreate).
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

  const noAssets = opts.assets === false;
  const skipCritic = opts.skipCritic === true;
  const assetBudgetUsd =
    opts.assetBudgetUsd !== undefined
      ? Math.max(0, Number.parseFloat(opts.assetBudgetUsd))
      : cfg.assets?.budget_usd ??
        (process.env.DEFAULT_ASSET_BUDGET_USD
          ? Math.max(0, Number.parseFloat(process.env.DEFAULT_ASSET_BUDGET_USD))
          : 2.0);

  // Phase 7.8.10: file-routed logger under the project workspace.
  const logger = createLogger({
    name: 'uaf.resume',
    filePath: join(project.dir, 'logs', 'resume.log'),
    ...(global.logStream ? { streamToConsole: true } : {}),
  });
  const progress = createProgressReporter();
  logger.info('resuming', {
    projectId: project.projectId,
    plan: plan.action.kind,
  });

  const { createClaudeStrategy } = await import('../../core/strategies/claude.js');
  const { runOrchestrator } = await import('../../core/orchestrator.js');
  const tracker = new BudgetTracker(budgetUsd, logger);
  const claude = createClaudeStrategy({
    ...(explicitModel !== undefined ? { model: explicitModel } : {}),
    ...(cfg.models ? { modelsByRole: cfg.models as Record<string, string> } : {}),
    logger,
  });
  const strategy = budgetedStrategy(claude, tracker);

  // Reconstruct a workspace handle pointing at the existing dir.
  const workspaceHandle: WorkspaceHandle = {
    projectId: project.projectId,
    dir: project.dir,
    branch: '(resume)',
    cleanup: async () => undefined,
  };
  setActiveProject({ projectId: project.projectId, workspaceDir: project.dir });

  const recipeType = project.state!.recipeType;
  const recipe = await loadRecipe(recipeType, { repoRoot });
  const metrics = new MetricsRecorder({
    projectId: project.projectId,
    dir: project.dir,
    logger,
  });
  const request = project.state!.originalRequest;

  let runErr: unknown;
  let doneFlag = false;
  let overall = 0;
  let haltReason: string | undefined;
  const start = Date.now();

  try {
    if (plan.action.kind === 'rerun-spec') {
      progress.phase('仕様を再作成します', '📋');
      const specResult = await runSpecWizard({
        request,
        workspaceDir: project.dir,
        projectId: project.projectId,
        recipe,
        strategy,
        metrics,
        repoRoot,
        ...(opts.yes ? { autoApprove: true } : {}),
        logger,
      });
      await upsertWorkspaceState(project.dir, {
        projectId: project.projectId,
        recipeType,
        originalRequest: request,
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
      // Fall through to roadmap.
    }

    if (plan.action.kind === 'rerun-spec' || plan.action.kind === 'rerun-roadmap') {
      progress.phase('ロードマップを再作成中', '📋');
      const roadmapResult = await buildRoadmap({
        workspaceDir: project.dir,
        projectId: project.projectId,
        request,
        recipe,
        strategy,
        metrics,
        repoRoot,
        logger,
      });
      await upsertWorkspaceState(project.dir, {
        projectId: project.projectId,
        recipeType,
        originalRequest: request,
        status: 'in-progress',
        phase: 'build',
        resumable: true,
        roadmap: roadmapResult.roadmap,
        lastCheckpointAt: new Date().toISOString(),
      });
    }

    // Reload state after potential roadmap rewrite.
    const refreshed = await findProject(workspaceBase, opts.projectId);
    const tasksToFinish = refreshed.state?.roadmap?.tasks ?? [];

    progress.phase('実装を再開します', '🔨');
    const report = await runOrchestrator({
      request,
      typeHint: recipeType,
      repoRoot,
      logger,
      strategy,
      maxIterations: maxIter,
      keepWorkspace: true,
      existingWorkspace: workspaceHandle,
      skipScaffold: files.packageJson, // already populated
      ...(noAssets ? { noAssets: true } : {}),
      ...(skipCritic ? { skipCritic: true } : {}),
      assetBudgetUsd,
    });
    haltReason = report.haltReason;
    doneFlag = report.completion.done;
    overall = report.completion.overall;

    if (doneFlag) {
      for (const t of tasksToFinish) {
        if (t.status !== 'completed' && t.status !== 'skipped') {
          await writeTaskCheckpoint(project.dir, {
            taskId: t.id,
            status: 'completed',
          });
        }
      }
    }
  } catch (err) {
    runErr = err;
    logger.error('resume threw', { error: err instanceof Error ? err.message : String(err) });
  } finally {
    clearActiveProject();
  }

  const elapsedSec = Math.round((Date.now() - start) / 1000);
  const metricsPath = join(project.dir, 'metrics.jsonl');
  const summary = await summarizeMetrics(metricsPath, explicitModel ?? 'claude-sonnet-4-6').catch(
    () => undefined,
  );

  const text = formatRunSummary({
    request,
    recipe: recipeType,
    projectId: project.projectId,
    workspaceDir: project.dir,
    metricsPath,
    elapsedSec,
    reportOk: !runErr,
    ...(haltReason !== undefined ? { haltReason } : {}),
    doneFlag,
    overall,
    toolStats: { total: 0, byTool: new Map() },
    ...(summary !== undefined ? { summary } : {}),
    budgetUsd,
  });
  process.stdout.write(text);
  try {
    await writeFile(join(project.dir, 'RUN_SUMMARY.txt'), text, 'utf8');
  } catch {
    /* non-fatal */
  }

  // Final state.json update mirroring create.ts.
  const phase: import('../../core/state.js').Phase = runErr
    ? 'failed'
    : haltReason
      ? 'failed'
      : doneFlag
        ? 'complete'
        : 'failed';
  await upsertWorkspaceState(project.dir, {
    projectId: project.projectId,
    recipeType,
    originalRequest: request,
    status: runErr ? 'failed' : haltReason ? 'halted' : doneFlag ? 'completed' : 'halted',
    phase,
    resumable: phase !== 'complete',
    entry: {
      ts: new Date().toISOString(),
      mode: 'iterate',
      request: '(resume)',
      ...(summary ? { costUsd: +summary.totalUsd.toFixed(4) } : {}),
      done: doneFlag,
      overall,
      ...(haltReason ? { haltReason } : {}),
    },
    lastCheckpointAt: new Date().toISOString(),
  });

  if (runErr) {
    if (runErr instanceof UafError) throw runErr;
    throw new UafError(runErr instanceof Error ? runErr.message : String(runErr), {
      code: 'RUNTIME_FAILURE',
      cause: runErr,
    });
  }
  if (haltReason) {
    throw new UafError(`resume halted: ${haltReason}`, {
      code: 'CIRCUIT_BREAKER_TRIPPED',
    });
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

function formatAge(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return '?';
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h`;
  return `${Math.round(sec / 86400)}d`;
}
