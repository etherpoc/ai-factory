/**
 * `uaf iterate` — apply a differential change to an existing workspace.
 *
 * Phase 7.5 implementation, following the decisions from the design review:
 *
 *   (Q1/B) Programmer reads existing code through its built-in tools (read_file,
 *          list_dir, bash). No static prompt embedding of sources.
 *   (Q2/D) Snapshot = Map<relPath, {mtime,size,sha256}> → Map diff. We also
 *          physically copy the workspace to .snapshots/<proj-id>-<ts>/ as a
 *          recoverable pre-iterate anchor.
 *   (Q3/G) Run all tests after iterate, but only after a **pre-check** that
 *          existing tests pass. Regressions are then trivially the delta.
 *   (Q4/J) `--dry-run` = no LLM calls at all; print the plan and exit.
 *
 * Default max-iterations for iterate is 1 (per additional proposal 2). The
 * idea is that a differential change is narrow and "one more sprint" is a
 * conscious decision the user makes by passing --max-iterations.
 */
import { exec } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import type { AgentInput, Artifacts, MetricRecord, SprintReport } from '../../core/types.js';
import { MetricsRecorder } from '../../core/metrics.js';
import { createLogger } from '../../core/logger.js';
import { loadRecipe } from '../../core/recipe-loader.js';
import { computeCost } from '../../core/pricing.js';
import { loadEffectiveConfig, resolveWorkspaceDir } from '../config/loader.js';
import { colors, symbols } from '../ui/colors.js';
import { UafError } from '../ui/errors.js';
import {
  findProject,
  upsertWorkspaceState,
  type WorkspaceState,
} from '../utils/workspace.js';
import {
  copyToSnapshot,
  diffSnapshots,
  snapshotWorkspace,
  type WorkspaceDiff,
} from '../utils/snapshot.js';
import { BudgetTracker, budgetedStrategy } from './_run-helpers.js';

const execAsync = promisify(exec);

export interface IterateOptions {
  projectId: string;
  request?: string;
  budgetUsd?: string;
  maxIterations?: string;
  maxRounds?: string;
  dryRun?: boolean;
}

export interface IterateGlobalOpts {
  verbose?: boolean;
}

// ---------------------------------------------------------------------------

export async function runIterate(
  opts: IterateOptions,
  _global: IterateGlobalOpts = {},
): Promise<void> {
  if (!opts.projectId) {
    throw new UafError('missing <proj-id>', {
      code: 'ARG_MISSING',
      hint: 'uaf iterate <proj-id> "<change request>"',
    });
  }
  if (!opts.request || opts.request.trim() === '') {
    throw new UafError('missing iterate request', {
      code: 'ARG_MISSING',
      hint: 'uaf iterate <proj-id> "<change request>"',
    });
  }

  // ---- 1. Locate project + recipe ---------------------------------------
  const { effective: cfg } = await loadEffectiveConfig();
  const workspaceBase = resolveWorkspaceDir(cfg, process.cwd());
  const project = await findProject(workspaceBase, opts.projectId);
  if (!project.state) {
    throw new UafError(`workspace/${opts.projectId}/state.json is missing`, {
      code: 'WORKSPACE_NOT_FOUND',
      hint: 'iterate requires state.json. Regenerate the project with `uaf create` first, or iterate manually via scripts/run.ts.',
    });
  }
  const state = project.state;
  const repoRoot = process.cwd();
  const recipe = await loadRecipe(state.recipeType, { repoRoot });

  const logger = createLogger({ name: 'uaf.iterate' });
  logger.info('iterate starting', {
    projectId: opts.projectId,
    recipe: state.recipeType,
    request: opts.request,
    existingIterations: state.iterations.length,
  });

  // ---- 2. Pre-check: existing tests pass --------------------------------
  process.stderr.write(colors.dim('→ running pre-check (existing tests)...\n'));
  const pre = await runRecipeTests(recipe.test.command, recipe.test.timeoutSec * 1000, project.dir);
  if (!pre.ok) {
    throw new UafError('pre-iterate test run failed', {
      code: 'REGRESSION_PRECONDITION_FAILED',
      details: { command: recipe.test.command, exit: pre.exit },
      hint: '先に既存テストを直してください (fix existing tests before iterating).',
      logPath: project.dir,
    });
  }
  process.stderr.write(colors.green(`${symbols.ok} pre-check passed\n`));

  // ---- 3. --dry-run exit path ------------------------------------------
  if (opts.dryRun) {
    printDryRunSummary(project, state, opts.request);
    return;
  }

  // ---- 4. API key guard -------------------------------------------------
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new UafError('ANTHROPIC_API_KEY is not set', {
      code: 'API_KEY_MISSING',
      hint: 'cp .env.example to .env and set your Anthropic API key.',
    });
  }

  // ---- 5. Budget + iteration caps --------------------------------------
  const budgetUsd = Math.max(
    0.01,
    opts.budgetUsd !== undefined ? Number.parseFloat(opts.budgetUsd) : cfg.budget_usd ?? 2.0,
  );
  // Per additional proposal 2: iterate defaults to 1, not cfg.max_iterations.
  const maxIter = Math.max(
    1,
    opts.maxIterations !== undefined ? Number.parseInt(opts.maxIterations, 10) : 1,
  );

  const tracker = new BudgetTracker(budgetUsd, logger);

  // ---- 6. Snapshot BEFORE (hash + physical) -----------------------------
  process.stderr.write(colors.dim('→ snapshotting workspace...\n'));
  const before = await snapshotWorkspace(project.dir);
  const snapshotPath = await copyToSnapshot(workspaceBase, project.projectId, project.dir);
  process.stderr.write(colors.dim(`  anchor: ${snapshotPath}\n`));

  // ---- 7. Build strategy + agents --------------------------------------
  const { createClaudeStrategy } = await import('../../core/strategies/claude.js');
  const { createAllAgents } = await import('../../agents/index.js');

  const firstRoundLogged = new Set<string>();
  const claude = createClaudeStrategy({
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
      logger.info('tool.call', {
        role: ev.role,
        tool: ev.tool,
        ok: ev.ok,
        durationMs: ev.durationMs,
        args: ev.argsSummary,
      });
    },
  });
  const strategy = budgetedStrategy(claude, tracker);

  const metrics = new MetricsRecorder({
    projectId: project.projectId,
    dir: project.dir,
    logger,
  });

  const agents = await createAllAgents({
    recipe,
    metrics,
    repoRoot,
    strategy,
  });

  // ---- 8. Iterate loop --------------------------------------------------
  // `artifacts.spec` carries the iterate directive in a form the programmer
  // already knows how to consume. Architect/Director are skipped; evaluator
  // still runs so we get a completion score.
  const artifacts: Artifacts = {
    spec: buildIterateSpec(state, opts.request),
    design: buildIterateDesign(state),
  };

  const start = Date.now();
  let done = false;
  let overall = 0;
  let lastSprint: SprintReport | undefined;

  for (let i = 0; i < maxIter; i += 1) {
    process.stderr.write(colors.dim(`→ iterate sprint ${i + 1}/${maxIter}\n`));
    const sprint = await runIterateSprint({
      agents,
      recipe,
      workspaceDir: project.dir,
      projectId: project.projectId,
      artifacts,
      iterateRequest: opts.request,
      logger,
    });
    lastSprint = sprint;
    overall = sprint.completion?.overall ?? 0;
    done = sprint.completion?.done ?? false;
    if (done) break;
    if (sprint.errors.length > 0) {
      logger.warn('sprint had errors', { errors: sprint.errors });
    }
  }
  const elapsedSec = Math.round((Date.now() - start) / 1000);

  // ---- 9. Snapshot AFTER + diff ----------------------------------------
  const after = await snapshotWorkspace(project.dir);
  const diff = diffSnapshots(before, after);

  // ---- 10. Cost accounting (re-read metrics.jsonl for this project) -----
  const iterCost = await costSince(project.dir, start);

  // ---- 11. Persist state.json entry ------------------------------------
  const nextStatus: WorkspaceState['status'] = done ? 'completed' : overall >= 60 ? 'in-progress' : 'halted';
  await upsertWorkspaceState(project.dir, {
    projectId: state.projectId,
    recipeType: state.recipeType,
    originalRequest: state.originalRequest,
    status: nextStatus,
    entry: {
      ts: new Date().toISOString(),
      mode: 'iterate',
      request: opts.request,
      costUsd: +iterCost.toFixed(4),
      done,
      overall,
      ...(lastSprint?.completion?.done === false && lastSprint?.errors.length
        ? { haltReason: lastSprint.errors.slice(-1)[0] }
        : {}),
      diff,
      snapshotPath,
      ...(lastSprint?.testReport
        ? {
            testsPassed: lastSprint.testReport.passed,
            testsFailed: lastSprint.testReport.failed,
          }
        : {}),
    },
  });

  // ---- 12. Report ------------------------------------------------------
  printIterateSummary({
    projectId: project.projectId,
    workspaceDir: project.dir,
    request: opts.request,
    elapsedSec,
    budgetUsd,
    cost: iterCost,
    done,
    overall,
    diff,
    snapshotPath,
    sprint: lastSprint,
  });

  // ---- 13. Exit code contract ------------------------------------------
  if (!done) {
    throw new UafError('iterate finished without reaching done=true', {
      code: 'RUNTIME_FAILURE',
      details: {
        projectId: project.projectId,
        overall,
        diff: { added: diff.added.length, modified: diff.modified.length, deleted: diff.deleted.length },
      },
      hint: `Review REPORT.md in ${project.dir}, then rerun with --max-iterations 2 if more passes are needed.`,
    });
  }
}

// ===========================================================================
// Sprint runner
// ===========================================================================

interface RunSprintInput {
  agents: Awaited<ReturnType<typeof import('../../agents/index.js').createAllAgents>>;
  recipe: import('../../core/types.js').Recipe;
  workspaceDir: string;
  projectId: string;
  artifacts: Artifacts;
  iterateRequest: string;
  logger: import('../../core/types.js').Logger;
}

async function runIterateSprint(x: RunSprintInput): Promise<SprintReport> {
  const sprint: SprintReport = { iteration: 1, reviewFindings: [], errors: [] };
  try {
    // Programmer — the only role that mutates the workspace.
    const progOut = await x.agents.programmer.invoke(
      makeInput(x, x.artifacts),
    );
    Object.assign(x.artifacts, progOut.artifacts);

    // Build
    const buildRes = await runBuild(x.recipe.build.command, x.recipe.build.timeoutSec * 1000, x.workspaceDir);
    if (!buildRes.ok) sprint.errors.push(`build failed: ${buildRes.output.slice(0, 200)}`);

    // Tests
    const testRes = await runRecipeTests(x.recipe.test.command, x.recipe.test.timeoutSec * 1000, x.workspaceDir);
    sprint.testReport = {
      passed: testRes.passed ?? 0,
      failed: testRes.failed ?? (testRes.ok ? 0 : 1),
      durationMs: testRes.durationMs,
      failures: [],
    };
    x.artifacts.testReport = sprint.testReport;
    if (sprint.testReport.failed > 0) sprint.errors.push(`${sprint.testReport.failed} test(s) failed`);

    // Evaluator (skip reviewer for iterate speed)
    const evalOut = await x.agents.evaluator.invoke(makeInput(x, x.artifacts));
    Object.assign(x.artifacts, evalOut.artifacts);
    sprint.completion = x.artifacts.completion;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sprint.errors.push(msg);
    x.logger.error('iterate sprint threw', { error: msg });
  }
  return sprint;
}

function makeInput(x: RunSprintInput, artifacts: Artifacts): AgentInput {
  return {
    projectId: x.projectId,
    workspaceDir: x.workspaceDir,
    request: x.iterateRequest,
    recipe: x.recipe,
    artifacts,
  };
}

// ===========================================================================
// Prompts synthesized for iterate
// ===========================================================================

function buildIterateSpec(state: WorkspaceState, iterateRequest: string): string {
  const lines: string[] = [];
  lines.push('# Iterate Mode');
  lines.push('');
  lines.push('**You are modifying an existing project.** The workspace already contains a working implementation — preserve it.');
  lines.push('');
  lines.push('## Rules');
  lines.push('1. **Preserve existing functionality** — do not break current features. Pre-iterate tests already pass; regressions mean you broke something.');
  lines.push('2. **Minimal changes** — only modify files necessary for the requested change.');
  lines.push('3. **No unprovoked refactoring** — if the user did not ask to refactor, do not.');
  lines.push('4. **Update tests** — add tests for new behavior, keep existing tests passing.');
  lines.push('5. **Explicit diff summary** — in your final response, list: files added, modified (brief), deleted.');
  lines.push('');
  lines.push('## Original request');
  lines.push(state.originalRequest);
  lines.push('');
  lines.push('## Iterate request (this run)');
  lines.push(iterateRequest);
  lines.push('');
  lines.push('## Previous iterations on this workspace');
  if (state.iterations.length === 0) {
    lines.push('- (none)');
  } else {
    for (const [i, it] of state.iterations.entries()) {
      lines.push(`- #${i + 1} [${it.mode}] ${it.ts}: ${it.request}`);
    }
  }
  lines.push('');
  lines.push('## How to discover existing code');
  lines.push('Use `list_dir` and `read_file` on the workspace directly — do not assume the layout from the original spec.');
  return lines.join('\n');
}

function buildIterateDesign(state: WorkspaceState): string {
  return [
    '# Iterate — design deferred',
    '',
    `Recipe: **${state.recipeType}**`,
    '',
    'Design was locked in during the initial `uaf create` run. Trust the existing code layout.',
    'Only restructure if the iterate request explicitly requires it.',
  ].join('\n');
}

// ===========================================================================
// Build + Test runners (reused from orchestrator defaults)
// ===========================================================================

interface RunResult {
  ok: boolean;
  output: string;
  exit?: number;
  durationMs: number;
}

async function runBuild(command: string, timeoutMs: number, cwd: string): Promise<RunResult> {
  const start = Date.now();
  try {
    const { stdout, stderr } = await execAsync(command, { cwd, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 });
    return { ok: true, output: [stdout, stderr].filter(Boolean).join('\n'), durationMs: Date.now() - start };
  } catch (err) {
    return { ok: false, output: err instanceof Error ? err.message : String(err), durationMs: Date.now() - start };
  }
}

interface TestResult extends RunResult {
  passed?: number;
  failed?: number;
}

async function runRecipeTests(command: string, timeoutMs: number, cwd: string): Promise<TestResult> {
  const start = Date.now();
  try {
    const { stdout, stderr } = await execAsync(command, { cwd, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 });
    const output = [stdout, stderr].filter(Boolean).join('\n');
    // Best-effort parse for common test runner outputs.
    const parsed = parseTestCounts(output);
    return { ok: true, output, durationMs: Date.now() - start, ...parsed };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const exit = typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : undefined;
    const parsed = parseTestCounts(msg);
    return { ok: false, output: msg, durationMs: Date.now() - start, ...(exit !== undefined ? { exit } : {}), ...parsed };
  }
}

function parseTestCounts(output: string): { passed?: number; failed?: number } {
  // vitest: "Tests 12 passed (12)" / "Tests 2 failed | 10 passed (12)"
  const vitestPass = /Tests[^\n]*?(\d+)\s+passed/i.exec(output);
  const vitestFail = /Tests[^\n]*?(\d+)\s+failed/i.exec(output);
  if (vitestPass || vitestFail) {
    return {
      passed: vitestPass ? Number.parseInt(vitestPass[1]!, 10) : 0,
      failed: vitestFail ? Number.parseInt(vitestFail[1]!, 10) : 0,
    };
  }
  // playwright: "12 passed" / "2 failed"
  const pwPass = /(\d+)\s+passed/i.exec(output);
  const pwFail = /(\d+)\s+failed/i.exec(output);
  if (pwPass || pwFail) {
    return {
      passed: pwPass ? Number.parseInt(pwPass[1]!, 10) : 0,
      failed: pwFail ? Number.parseInt(pwFail[1]!, 10) : 0,
    };
  }
  return {};
}

// ===========================================================================
// Cost calc (reads our own metrics.jsonl for entries with ts >= sinceMs)
// ===========================================================================

async function costSince(workspaceDir: string, sinceMs: number): Promise<number> {
  const { readFile } = await import('node:fs/promises');
  let raw: string;
  try {
    raw = await readFile(`${workspaceDir}/metrics.jsonl`, 'utf8');
  } catch {
    return 0;
  }
  let total = 0;
  for (const line of raw.split('\n').filter(Boolean)) {
    let rec: MetricRecord;
    try {
      rec = JSON.parse(line) as MetricRecord;
    } catch {
      continue;
    }
    const ts = Date.parse(rec.ts);
    if (Number.isFinite(ts) && ts < sinceMs) continue;
    total += computeCost(rec.model, {
      inputTokens: rec.inputTokens,
      outputTokens: rec.outputTokens,
      cacheReadTokens: rec.cacheReadTokens,
      cacheCreationTokens: rec.cacheCreationTokens,
    });
  }
  return total;
}

// ===========================================================================
// Summary printers
// ===========================================================================

function printDryRunSummary(
  project: { projectId: string; dir: string },
  state: WorkspaceState,
  request: string,
): void {
  const out: string[] = [];
  out.push(colors.bold(`=== uaf iterate (dry-run) ===`));
  out.push(`Project : ${project.projectId}`);
  out.push(`  Path     : ${project.dir}`);
  out.push(`  Created  : ${state.createdAt}`);
  out.push(`  Recipe   : ${state.recipeType}`);
  out.push(`  Status   : ${state.status}`);
  out.push(`  Iterations so far: ${state.iterations.length}`);
  out.push('');
  out.push(`Iterate request: "${request}"`);
  out.push('');
  out.push(colors.dim('Dry run mode: no changes will be made, no LLM calls.'));
  out.push(colors.dim('Estimated cost (iterate): ~$0.30 - $0.60 depending on scope.'));
  process.stdout.write(out.join('\n') + '\n');
}

function printIterateSummary(x: {
  projectId: string;
  workspaceDir: string;
  request: string;
  elapsedSec: number;
  budgetUsd: number;
  cost: number;
  done: boolean;
  overall: number;
  diff: WorkspaceDiff;
  snapshotPath: string;
  sprint?: SprintReport;
}): void {
  const out: string[] = [];
  out.push('');
  out.push(colors.bold('=== UAF iterate summary ==='));
  out.push(`projectId  : ${x.projectId}`);
  out.push(`workspace  : ${x.workspaceDir}`);
  out.push(`request    : ${x.request}`);
  out.push(`elapsed    : ${x.elapsedSec}s`);
  out.push(`completion : done=${x.done} overall=${x.overall}/100`);
  out.push(`cost       : $${x.cost.toFixed(4)} (budget $${x.budgetUsd.toFixed(2)})`);
  if (x.sprint?.testReport) {
    out.push(
      `tests      : ${x.sprint.testReport.passed} passed, ${x.sprint.testReport.failed} failed`,
    );
  }
  out.push('');
  out.push(colors.bold('diff'));
  out.push(`  added    : ${x.diff.added.length}`);
  for (const p of x.diff.added.slice(0, 10)) out.push(`    ${colors.green('+')} ${p}`);
  if (x.diff.added.length > 10) out.push(colors.dim(`    … ${x.diff.added.length - 10} more`));
  out.push(`  modified : ${x.diff.modified.length}`);
  for (const p of x.diff.modified.slice(0, 10)) out.push(`    ${colors.yellow('~')} ${p}`);
  if (x.diff.modified.length > 10) out.push(colors.dim(`    … ${x.diff.modified.length - 10} more`));
  out.push(`  deleted  : ${x.diff.deleted.length}`);
  for (const p of x.diff.deleted.slice(0, 10)) out.push(`    ${colors.red('-')} ${p}`);
  out.push(`  bytesΔ   : ${x.diff.bytesDelta >= 0 ? '+' : ''}${x.diff.bytesDelta}`);
  out.push('');
  out.push(colors.dim(`snapshot : ${x.snapshotPath}`));
  process.stdout.write(out.join('\n') + '\n');

  // Also persist a short text report alongside REPORT.md.
  void writeFile(
    `${x.workspaceDir}/ITERATE_LAST.txt`,
    out.join('\n'),
    'utf8',
  ).catch(() => undefined);
}

// ===========================================================================
// Exit-code hook
// ===========================================================================

// Add the iterate-specific UafError codes so exitCodeFor resolves cleanly.
// (The module is side-effectful to keep the mapping in a single place —
// tests lock this via tests/cli/exit-codes.test.ts.)
