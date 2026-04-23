import { exec } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, cp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type {
  Agent,
  AgentInput,
  AgentOutput,
  AgentRole,
  Artifacts,
  CompletionScore,
  CircuitBreakerConfig,
  Criterion,
  Logger,
  OrchestratorInput,
  OrchestratorReport,
  ProjectSpec,
  Recipe,
  SprintReport,
  TestReport,
  Tool,
  WorkspaceHandle,
} from './types.js';
import { stubStrategy } from './agent-factory.js';
import type { AgentStrategy } from './agent-factory.js';
import { CircuitBreaker, createBreaker, resolveBreakerConfig } from './circuit-breaker.js';
import { classify } from './classifier.js';
import { createLogger, nullLogger } from './logger.js';
import { MetricsRecorder } from './metrics.js';
import { loadRecipe } from './recipe-loader.js';
import { createWorkspace } from './workspace-manager.js';
import { createAllAgents } from '../agents/index.js';
import type { AssetGenerator } from './asset-generator.js';
import { createGenerateAudioTool, createGenerateImageTool } from './tools/asset-tools.js';

const execAsync = promisify(exec);

type AgentMap = Record<AgentRole, Agent>;

export interface OrchestratorDeps {
  classify?(request: string, typeHint?: string): Promise<ProjectSpec>;
  loadRecipe?(type: string, repoRoot: string): Promise<Recipe>;
  createWorkspace?(projectId: string, repoRoot: string, logger: Logger): Promise<WorkspaceHandle>;
  makeAgents?(
    recipe: Recipe,
    metrics: MetricsRecorder,
    repoRoot: string,
    extras?: { toolRegistry?: ReadonlyMap<string, Tool> },
  ): Promise<AgentMap>;
  scaffold?(
    recipe: Recipe,
    workspace: WorkspaceHandle,
    logger: Logger,
    repoRoot: string,
  ): Promise<void>;
  build?(recipe: Recipe, workspace: WorkspaceHandle): Promise<{ ok: boolean; output: string }>;
  runTests?(recipe: Recipe, workspace: WorkspaceHandle): Promise<TestReport>;
  evaluate?(
    recipe: Recipe,
    artifacts: Artifacts,
    buildOk: boolean,
    testReport: TestReport | undefined,
    workspace: WorkspaceHandle,
    repoRoot: string,
  ): Promise<CompletionScore> | CompletionScore;
}

export interface OrchestratorOptions extends OrchestratorInput {
  repoRoot?: string;
  logger?: Logger;
  breakerConfig?: Partial<CircuitBreakerConfig>;
  deps?: OrchestratorDeps;
  strategy?: AgentStrategy;
  /** Skip workspace.cleanup() at the end so the user can inspect the output. */
  keepWorkspace?: boolean;
  // ---- Phase 7.8: caller-managed workspace ----------------------------------
  /**
   * If supplied, the orchestrator uses this workspace instead of creating a
   * new one. Lets CLI commands create the workspace early (before spec /
   * roadmap phases) so SIGINT can register an active project before any LLM
   * work starts. The orchestrator will NOT call workspace.cleanup() unless
   * `keepWorkspace === false`; callers are expected to manage cleanup.
   */
  existingWorkspace?: WorkspaceHandle;
  /**
   * If supplied, also skip workspace creation AND scaffold (template copy /
   * generator). Useful when resuming — the workspace already has the scaffold.
   */
  skipScaffold?: boolean;
  // ---- Phase 11.a: creative-agent wiring ----------------------------------
  /** If set, artist/sound's `generate_image`/`generate_audio` tools wrap it. */
  assetGenerator?: AssetGenerator;
  /** `--no-assets`: skip artist + sound. */
  noAssets?: boolean;
  /** `--skip-critic`: skip critic. */
  skipCritic?: boolean;
  /** Asset budget (USD). 0 auto-skips artist + sound even if they're in `agents.optional`. */
  assetBudgetUsd?: number;
}

// ---------------------------------------------------------------------------
// Role resolution (R6 エージェント宣言原則)
// ---------------------------------------------------------------------------

const LEGACY_REQUIRED_ROLES: readonly AgentRole[] = [
  'director',
  'architect',
  'programmer',
  'tester',
  'reviewer',
  'evaluator',
];

/**
 * Decide which roles will actually run in this orchestrator invocation.
 *
 * Precedence (simple on purpose — the user explicitly asked not to infer from
 * the project spec):
 *
 *   1. `recipe.agents.required` OR the legacy 6-role list.
 *   2. `recipe.agents.optional` are enabled by default when declared.
 *   3. Opt-outs:
 *        --no-assets           drops artist + sound
 *        --skip-critic         drops critic
 *        assetBudgetUsd === 0  drops artist + sound
 */
export function resolveActiveRoles(
  recipe: Recipe,
  flags: { noAssets?: boolean; skipCritic?: boolean; assetBudgetUsd?: number } = {},
): Set<AgentRole> {
  const required = recipe.agents?.required.length ? recipe.agents.required : LEGACY_REQUIRED_ROLES;
  const optional = recipe.agents?.optional ?? [];
  const active = new Set<AgentRole>(required);
  const assetsDisabled = flags.noAssets === true || flags.assetBudgetUsd === 0;
  for (const role of optional) {
    if ((role === 'artist' || role === 'sound') && assetsDisabled) continue;
    if (role === 'critic' && flags.skipCritic) continue;
    active.add(role);
  }
  return active;
}

export async function runOrchestrator(opts: OrchestratorOptions): Promise<OrchestratorReport> {
  const repoRoot = resolve(opts.repoRoot ?? process.cwd());
  const logger = opts.logger ?? createLogger({ name: 'uaf.orchestrator' });
  const deps = opts.deps ?? {};

  // 1. Classify
  const spec = await (deps.classify ?? defaultClassify)(opts.request, opts.typeHint);
  logger.info('classified request', { type: spec.type, slug: spec.slug });

  // 2. Load recipe
  const recipe = await (deps.loadRecipe ?? defaultLoadRecipe)(spec.type, repoRoot);

  // 3. Create workspace (or reuse a caller-supplied one — Phase 7.8).
  // F20 FIX: projectId is `<timestamp>-<sha256 prefix>` (no request-derived slug).
  // Raw request lives in REPORT.md. Keeping the dir name short prevents pnpm
  // symlink hoist from silently failing on Windows (MAX_PATH) for long
  // multi-byte Japanese requests. spec.slug is still computed for display.
  const projectId = opts.existingWorkspace
    ? opts.existingWorkspace.projectId
    : makeProjectId(opts.request);
  const workspace = opts.existingWorkspace
    ? opts.existingWorkspace
    : await (deps.createWorkspace ?? defaultCreateWorkspace)(projectId, repoRoot, logger);
  logger.info('workspace ready', { dir: workspace.dir, reused: !!opts.existingWorkspace });

  const metrics = new MetricsRecorder({ projectId, dir: workspace.dir, logger });

  // Phase 11.a: work out which roles run this invocation.
  const activeRoles = resolveActiveRoles(recipe, {
    ...(opts.noAssets !== undefined ? { noAssets: opts.noAssets } : {}),
    ...(opts.skipCritic !== undefined ? { skipCritic: opts.skipCritic } : {}),
    ...(opts.assetBudgetUsd !== undefined ? { assetBudgetUsd: opts.assetBudgetUsd } : {}),
  });
  logger.info('active roles', { roles: [...activeRoles].sort() });

  // Build a tool registry for `generate_image` / `generate_audio` if an
  // AssetGenerator is available AND at least one creative agent needs it.
  // When it's absent, the artist/sound agents still exist but their tool
  // list drops the generate_* entries (resolveTools handles missing names).
  const toolRegistry: ReadonlyMap<string, Tool> | undefined = opts.assetGenerator
    ? buildAssetToolRegistry(opts.assetGenerator, activeRoles)
    : undefined;

  try {
    const agents = await (deps.makeAgents ?? defaultMakeAgents(opts.strategy))(
      recipe,
      metrics,
      repoRoot,
      toolRegistry ? { toolRegistry } : undefined,
    );

    const artifacts: Artifacts = {};

    // 4. Director → spec.md (Phase 7.8: skip if interviewer already wrote it).
    if (await fileExists(join(workspace.dir, 'spec.md'))) {
      artifacts.spec = await readFile(join(workspace.dir, 'spec.md'), 'utf8');
      logger.info('director: skipped (spec.md already present)');
    } else {
      await invokeInto(
        agents.director,
        artifactInput(spec, workspace, recipe, artifacts),
        artifacts,
      );
      if (artifacts.spec) {
        await writeFile(join(workspace.dir, 'spec.md'), artifacts.spec, 'utf8');
      }
    }

    // 5. Architect → design.md (skip if it already exists, e.g. on resume).
    if (await fileExists(join(workspace.dir, 'design.md'))) {
      artifacts.design = await readFile(join(workspace.dir, 'design.md'), 'utf8');
      logger.info('architect: skipped (design.md already present)');
    } else {
      await invokeInto(
        agents.architect,
        artifactInput(spec, workspace, recipe, artifacts),
        artifacts,
      );
      if (artifacts.design) {
        await writeFile(join(workspace.dir, 'design.md'), artifacts.design, 'utf8');
      }
    }

    // 6. Scaffold (Phase 7.8: skip when caller already populated workspace,
    // e.g. on resume after a crash mid-build).
    if (!opts.skipScaffold) {
      await (deps.scaffold ?? defaultScaffold)(recipe, workspace, logger, repoRoot);
    } else {
      logger.info('scaffold: skipped (skipScaffold=true)');
    }

    // 6.5 (Phase 11.a) Creative phase — writer / artist / sound run in
    // parallel. They all read spec.md + design.md (via tools) and write
    // their manifests; Programmer reads them in step 7.
    const creativeTasks: Array<Promise<unknown>> = [];
    for (const role of ['writer', 'artist', 'sound'] as const) {
      if (!activeRoles.has(role)) continue;
      logger.info('creative agent invoked', { role });
      creativeTasks.push(
        invokeInto(agents[role], artifactInput(spec, workspace, recipe, artifacts), artifacts).catch(
          (err: unknown) => {
            // Creative-agent failures are non-fatal: log and continue so the
            // build can still produce a working (if visually bare) project.
            logger.warn('creative agent threw', {
              role,
              error: err instanceof Error ? err.message : String(err),
            });
          },
        ),
      );
    }
    if (creativeTasks.length > 0) {
      await Promise.all(creativeTasks);
    }

    // 7. Loop
    const breakerCfg = resolveBreakerConfig({
      ...(opts.breakerConfig ?? {}),
      ...(opts.maxIterations !== undefined ? { maxIterations: opts.maxIterations } : {}),
    });
    const breaker = createBreaker(breakerCfg);

    const iterations: SprintReport[] = [];
    let lastScore: CompletionScore | undefined;

    while (!breaker.tripped()) {
      const sprint: SprintReport = {
        iteration: breaker.state.iteration + 1,
        reviewFindings: [],
        errors: [],
      };
      try {
        await invokeInto(
          agents.programmer,
          artifactInput(spec, workspace, recipe, artifacts),
          artifacts,
        );

        const buildResult = await (deps.build ?? defaultBuild)(recipe, workspace);
        if (!buildResult.ok)
          sprint.errors.push(`build failed: ${truncate(buildResult.output, 200)}`);

        await invokeInto(
          agents.tester,
          artifactInput(spec, workspace, recipe, artifacts),
          artifacts,
        );
        const testReport = await (deps.runTests ?? defaultRunTests)(recipe, workspace);
        sprint.testReport = testReport;
        artifacts.testReport = testReport;
        if (testReport.failed > 0) {
          sprint.errors.push(`${testReport.failed} test(s) failed`);
        }

        // Phase 11.a: Critic runs after Tester but before Reviewer so its
        // subjective feedback is visible in the same sprint's REPORT.md.
        // Failures are non-fatal — critic is opinion, not correctness.
        if (activeRoles.has('critic')) {
          try {
            await invokeInto(
              agents.critic,
              artifactInput(spec, workspace, recipe, artifacts),
              artifacts,
            );
          } catch (err) {
            logger.warn('critic threw', {
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        await invokeInto(
          agents.reviewer,
          artifactInput(spec, workspace, recipe, artifacts),
          artifacts,
        );
        sprint.reviewFindings = artifacts.reviewFindings ?? [];

        await invokeInto(
          agents.evaluator,
          artifactInput(spec, workspace, recipe, artifacts),
          artifacts,
        );
        const deterministic = await (deps.evaluate ?? defaultEvaluate)(
          recipe,
          artifacts,
          buildResult.ok,
          testReport,
          workspace,
          repoRoot,
        );
        const score = mergeCompletion(
          deterministic,
          artifacts.completion,
          recipe.evaluation.criteria,
        );
        artifacts.completion = score;
        sprint.completion = score;
        lastScore = score;

        iterations.push(sprint);

        if (score.done) {
          logger.info('evaluator declared done', { overall: score.overall });
          break;
        }

        breaker.tick(sprint.errors.join(' | ') || undefined);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sprint.errors.push(msg);
        iterations.push(sprint);
        logger.error('sprint threw', { error: msg });
        breaker.tick(msg);
      }
    }

    const completion = lastScore ?? emptyScore();
    const report: OrchestratorReport = {
      projectId,
      workspaceDir: workspace.dir,
      summary: summarize(spec, recipe, iterations, completion, breaker),
      completion,
      iterations,
      halted: breaker.tripped() && !completion.done,
      ...(breaker.state.tripReason ? { haltReason: breaker.state.tripReason } : {}),
    };
    await writeFile(join(workspace.dir, 'REPORT.md'), report.summary, 'utf8');
    logger.info('orchestrator complete', {
      projectId,
      halted: report.halted,
      iterations: iterations.length,
    });
    return report;
  } finally {
    // Cleanup policy:
    //   - existingWorkspace: caller manages cleanup, never call here.
    //   - keepWorkspace=true: explicit opt-out (default for `uaf create` so
    //     the user can inspect output).
    //   - otherwise: remove the workspace (used by some integration tests).
    if (!opts.existingWorkspace && !opts.keepWorkspace) {
      await workspace
        .cleanup()
        .catch((err) => logger.warn('workspace cleanup failed', { error: String(err) }));
    }
  }
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

async function defaultClassify(request: string, typeHint?: string): Promise<ProjectSpec> {
  return classify(request, typeHint !== undefined ? { typeHint } : {});
}

async function defaultLoadRecipe(type: string, repoRoot: string): Promise<Recipe> {
  return loadRecipe(type, { repoRoot });
}

async function defaultCreateWorkspace(
  projectId: string,
  repoRoot: string,
  logger: Logger,
): Promise<WorkspaceHandle> {
  return createWorkspace({ projectId, repoRoot, logger });
}

function defaultMakeAgents(strategy?: AgentStrategy) {
  return async (
    recipe: Recipe,
    metrics: MetricsRecorder,
    repoRoot: string,
    extras?: { toolRegistry?: ReadonlyMap<string, Tool> },
  ): Promise<AgentMap> => {
    return createAllAgents({
      recipe,
      metrics,
      repoRoot,
      strategy: strategy ?? stubStrategy,
      ...(extras?.toolRegistry ? { toolRegistry: extras.toolRegistry } : {}),
    });
  };
}

/**
 * Construct the tool registry that the creative agents need. Only includes
 * the tools an active role actually uses — avoids handing `generate_audio`
 * to a run that doesn't have the sound agent.
 */
function buildAssetToolRegistry(
  gen: AssetGenerator,
  activeRoles: Set<AgentRole>,
): ReadonlyMap<string, Tool> {
  const reg = new Map<string, Tool>();
  if (activeRoles.has('artist')) reg.set('generate_image', createGenerateImageTool(gen));
  if (activeRoles.has('sound')) reg.set('generate_audio', createGenerateAudioTool(gen));
  return reg;
}

export async function defaultScaffold(
  recipe: Recipe,
  workspace: WorkspaceHandle,
  logger: Logger,
  repoRoot: string,
): Promise<void> {
  if (recipe.scaffold.type === 'generator') {
    logger.info('scaffold: running generator', { cmd: recipe.scaffold.command });
    await execAsync(recipe.scaffold.command, { cwd: workspace.dir, timeout: 10 * 60_000 });
    return;
  }
  const src = join(resolve(repoRoot), 'recipes', recipe.meta.type, recipe.scaffold.path);
  logger.info('scaffold: copying template', { src, dest: workspace.dir });
  await cp(src, workspace.dir, { recursive: true });
}

async function defaultBuild(
  recipe: Recipe,
  workspace: WorkspaceHandle,
): Promise<{ ok: boolean; output: string }> {
  try {
    const { stdout, stderr } = await execAsync(recipe.build.command, {
      cwd: workspace.dir,
      timeout: recipe.build.timeoutSec * 1000,
      ...(recipe.build.env ? { env: { ...process.env, ...recipe.build.env } } : {}),
    });
    return { ok: true, output: [stdout, stderr].filter(Boolean).join('\n') };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, output: msg };
  }
}

async function defaultRunTests(recipe: Recipe, workspace: WorkspaceHandle): Promise<TestReport> {
  const start = Date.now();
  try {
    await execAsync(recipe.test.command, {
      cwd: workspace.dir,
      timeout: recipe.test.timeoutSec * 1000,
      ...(recipe.test.env ? { env: { ...process.env, ...recipe.test.env } } : {}),
    });
    return { passed: 1, failed: 0, durationMs: Date.now() - start, failures: [] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      passed: 0,
      failed: 1,
      durationMs: Date.now() - start,
      failures: [{ suite: 'test', name: recipe.test.command, message: msg }],
    };
  }
}

export async function defaultEvaluate(
  recipe: Recipe,
  _artifacts: Artifacts,
  buildOk: boolean,
  testReport: TestReport | undefined,
  workspace: WorkspaceHandle,
  repoRoot: string,
): Promise<CompletionScore> {
  const entrypointStatus = await checkEntrypointsImplemented(recipe, workspace, repoRoot);
  const perCriterion = recipe.evaluation.criteria.map((c) => {
    const { passed, evidence } = judgeCriterion(c.id, buildOk, testReport, entrypointStatus);
    return { id: c.id, passed, required: c.required, evidence };
  });
  const requiredPassed =
    perCriterion.length > 0 && perCriterion.filter((c) => c.required).every((c) => c.passed);
  const passedCount = perCriterion.filter((c) => c.passed).length;
  const overall =
    perCriterion.length === 0
      ? buildOk
        ? 50
        : 0
      : Math.round((passedCount / perCriterion.length) * 100);
  return {
    overall,
    perCriterion,
    done: requiredPassed,
  };
}

interface EntrypointStatus {
  known: true;
  allModified: boolean;
  unmodified: string[];
  checked: string[];
}
type EntrypointResult = EntrypointStatus | { known: false };

async function checkEntrypointsImplemented(
  recipe: Recipe,
  workspace: WorkspaceHandle,
  repoRoot: string,
): Promise<EntrypointResult> {
  const paths = recipe.evaluation.entrypoints;
  if (!paths || paths.length === 0) return { known: false };
  if (recipe.scaffold.type !== 'template') return { known: false };
  const templateRoot = join(resolve(repoRoot), 'recipes', recipe.meta.type, recipe.scaffold.path);
  const { readFile } = await import('node:fs/promises');
  const unmodified: string[] = [];
  for (const rel of paths) {
    try {
      const templateBytes = await readFile(join(templateRoot, rel));
      const workspaceBytes = await readFile(join(workspace.dir, rel));
      if (templateBytes.equals(workspaceBytes)) {
        unmodified.push(rel);
      }
    } catch {
      // If either file is missing, treat as unmodified-ish (programmer hasn't created it).
      unmodified.push(rel);
    }
  }
  return { known: true, allModified: unmodified.length === 0, unmodified, checked: paths };
}

/** Merge deterministic judgment with the LLM evaluator's self-reported score.
 *  For criteria the orchestrator can evaluate deterministically, the orchestrator wins (R3).
 */
export function mergeCompletion(
  deterministic: CompletionScore,
  llm: CompletionScore | undefined,
  criteria: readonly Criterion[],
): CompletionScore {
  if (!llm) return deterministic;
  const byId = new Map(deterministic.perCriterion.map((c) => [c.id, c]));
  const merged = criteria.map((c) => {
    const det = byId.get(c.id);
    if (det && det.evidence !== UNKNOWN_EVIDENCE) return det;
    const llmItem = llm.perCriterion.find((x) => x.id === c.id);
    if (llmItem) return llmItem;
    return { id: c.id, passed: false, required: c.required, evidence: 'no judgment' };
  });
  const requiredPassed =
    merged.length > 0 && merged.filter((c) => c.required).every((c) => c.passed);
  const passedCount = merged.filter((c) => c.passed).length;
  return {
    overall: merged.length === 0 ? 0 : Math.round((passedCount / merged.length) * 100),
    perCriterion: merged,
    done: requiredPassed,
  };
}

const UNKNOWN_EVIDENCE = 'no deterministic check available';

function judgeCriterion(
  id: string,
  buildOk: boolean,
  testReport: TestReport | undefined,
  entrypoints: EntrypointResult,
): { passed: boolean; evidence: string } {
  switch (id) {
    case 'builds':
      return { passed: buildOk, evidence: buildOk ? 'build command exited 0' : 'build failed' };
    case 'tests-pass':
    case 'unit-tests':
    case 'e2e-pass':
      if (!testReport) return { passed: false, evidence: 'no test report' };
      return {
        passed: testReport.failed === 0 && testReport.passed > 0,
        evidence: `${testReport.passed} pass / ${testReport.failed} fail`,
      };
    case 'entrypoints-implemented':
      if (!entrypoints.known) {
        return {
          passed: false,
          evidence: 'recipe.evaluation.entrypoints is empty (cannot verify)',
        };
      }
      return entrypoints.allModified
        ? {
            passed: true,
            evidence: `all entrypoints differ from scaffold template: ${entrypoints.checked.join(', ')}`,
          }
        : {
            passed: false,
            evidence: `entrypoint(s) still byte-identical to template: ${entrypoints.unmodified.join(', ')}`,
          };
    default:
      return { passed: false, evidence: UNKNOWN_EVIDENCE };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function invokeInto(agent: Agent, input: AgentInput, artifacts: Artifacts): Promise<void> {
  const output: AgentOutput = await agent.invoke(input);
  Object.assign(artifacts, output.artifacts);
}

function artifactInput(
  spec: ProjectSpec,
  workspace: WorkspaceHandle,
  recipe: Recipe,
  artifacts: Artifacts,
): AgentInput {
  return {
    projectId: workspace.projectId,
    workspaceDir: workspace.dir,
    request: spec.rawRequest,
    recipe,
    artifacts,
  };
}

function yyyymmddHHmm(d = new Date()): string {
  const p = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}`;
}

/**
 * F20: deterministic 6-char hex prefix of SHA-256(request).
 * 16M distinct values → collision within a single minute is negligible.
 */
export function requestHash(request: string): string {
  return createHash('sha256').update(request).digest('hex').slice(0, 6);
}

/**
 * Phase 7.8: project-id derivation factored out so CLI commands can create
 * the workspace before runOrchestrator runs. `<timestamp>-<sha256-prefix>`.
 */
export function makeProjectId(request: string, d = new Date()): string {
  return `${yyyymmddHHmm(d)}-${requestHash(request)}`;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

function emptyScore(): CompletionScore {
  return { overall: 0, perCriterion: [], done: false };
}

function summarize(
  spec: ProjectSpec,
  recipe: Recipe,
  iterations: SprintReport[],
  completion: CompletionScore,
  breaker: CircuitBreaker,
): string {
  const lines: string[] = [];
  lines.push(`# ${spec.slug} — ${recipe.meta.type} report`);
  lines.push('');
  lines.push(`- Request: ${spec.rawRequest}`);
  lines.push(`- Recipe: ${recipe.meta.type} v${recipe.meta.version}`);
  lines.push(`- Iterations: ${iterations.length}`);
  lines.push(`- Overall score: ${completion.overall}/100`);
  lines.push(`- Done: ${completion.done ? 'yes' : 'no'}`);
  if (breaker.state.tripped) {
    lines.push(`- Halted: ${breaker.state.tripReason ?? 'breaker tripped'}`);
  }
  lines.push('');
  lines.push('## Criteria');
  for (const c of completion.perCriterion) {
    const mark = c.passed ? '✓' : '✗';
    lines.push(`- ${mark} ${c.id}${c.required ? ' (required)' : ''}: ${c.evidence}`);
  }
  lines.push('');
  lines.push('## Iterations');
  for (const it of iterations) {
    lines.push(
      `### ${it.iteration} — tests ${it.testReport ? `${it.testReport.passed}/${it.testReport.passed + it.testReport.failed}` : 'n/a'}`,
    );
    if (it.errors.length > 0) lines.push(`  errors: ${it.errors.join('; ')}`);
  }
  return lines.join('\n') + '\n';
}

/** Re-exported for consumers that want to use the helpers without going through runOrchestrator. */
export { nullLogger };
