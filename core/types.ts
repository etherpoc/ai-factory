/**
 * Universal Agent Factory — shared type definitions.
 *
 * This file is the single source of truth for cross-layer contracts (core, agents, recipes, meta).
 * Everything more specific than a primitive that crosses a module boundary lives here.
 */

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export type AgentRole =
  | 'director'
  | 'architect'
  | 'programmer'
  | 'tester'
  | 'reviewer'
  | 'evaluator'
  // Phase 11.a creative agents. All four are optional per-recipe; existing
  // recipes stay behavior-identical if they omit them.
  | 'artist'
  | 'sound'
  | 'writer'
  | 'critic';

/**
 * Tool exposed to an agent. Kept intentionally minimal so we can back it with
 * either the Claude Agent SDK's native tool descriptor or a local shim.
 */
export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

export interface ToolContext {
  workspaceDir: string;
  projectId: string;
  logger: Logger;
}

export type ToolResult = { ok: true; output: unknown } | { ok: false; error: string };

export interface AgentInput {
  projectId: string;
  workspaceDir: string;
  request: string;
  recipe: Recipe;
  artifacts: Artifacts;
  previous?: SprintReport;
}

export interface AgentOutput {
  role: AgentRole;
  artifacts: Partial<Artifacts>;
  /** Free-form notes for downstream agents. */
  notes?: string;
  /** Metrics recorded during this invocation (token, latency, model, …). */
  metrics: MetricRecord[];
}

export interface Agent {
  name: string;
  role: AgentRole;
  systemPrompt: string;
  tools: Tool[];
  invoke(input: AgentInput): Promise<AgentOutput>;
}

// ---------------------------------------------------------------------------
// Artifacts — everything produced by agents that the next stage may consume.
// ---------------------------------------------------------------------------

export interface Artifacts {
  spec?: string; // Director — PRD/GDD markdown
  design?: string; // Architect — technical design markdown
  tasks?: string[]; // Director — sprint task list
  changedFiles?: string[]; // Programmer — relative paths touched this sprint
  testReport?: TestReport;
  reviewFindings?: ReviewFinding[];
  completion?: CompletionScore;
}

export interface TestReport {
  passed: number;
  failed: number;
  durationMs: number;
  failures: TestFailure[];
}

export interface TestFailure {
  suite: string;
  name: string;
  message: string;
  stack?: string;
}

export interface ReviewFinding {
  file: string;
  line?: number;
  severity: 'info' | 'warn' | 'error';
  message: string;
}

export interface CompletionScore {
  overall: number; // 0..100
  perCriterion: {
    id: string;
    passed: boolean;
    required: boolean;
    evidence: string;
  }[];
  done: boolean;
}

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------

export interface RecipeMeta {
  type: string;
  version: string;
  description: string;
}

export interface StackSpec {
  language: string;
  framework: string;
  deps: string[];
}

export type ScaffoldSpec =
  | { type: 'template'; path: string }
  | { type: 'generator'; command: string };

export interface CommandSpec {
  command: string;
  timeoutSec: number;
  /** Optional env vars merged into process.env for this command. */
  env?: Record<string, string>;
}

export interface Criterion {
  id: string;
  description: string;
  required: boolean;
}

export interface EvaluationSpec {
  criteria: Criterion[];
  /**
   * Relative paths (from workspaceDir) that must differ from the corresponding
   * file in the scaffold template. Used by the deterministic `entrypoints-implemented`
   * criterion to catch "empty scaffold passes everything" situations.
   */
  entrypoints?: string[];
}

export interface AgentOverride {
  promptAppend: string;
  additionalTools?: string[];
  /** Override the model used for this role in the recipe (e.g. "claude-opus-4-7"). */
  model?: string;
}

export interface Recipe {
  meta: RecipeMeta;
  stack: StackSpec;
  scaffold: ScaffoldSpec;
  agentOverrides: Partial<Record<AgentRole, AgentOverride>>;
  build: CommandSpec;
  test: CommandSpec;
  evaluation: EvaluationSpec;
  // Phase 11.a additions — both optional for backward compatibility.
  agents?: AgentsSpec;
  assets?: AssetsSpec;
}

/**
 * R6 エージェント宣言原則. `required` are always invoked; `optional` are
 * enabled by default when the recipe lists them and can be opted out of via
 * CLI flags (--no-assets, --skip-critic) or --asset-budget-usd=0.
 */
export interface AgentsSpec {
  required: AgentRole[];
  optional: AgentRole[];
}

/** R9 コスト上限原則. Budget caps enforced by `core/asset-generator.ts`. */
export interface AssetBudget {
  maxUsd?: number;
  maxCount?: number;
}

export interface AssetsImageSpec {
  defaultStyle?: 'pixel-art' | 'illustration' | 'photo' | 'icon' | 'ui';
  defaultProvider?: string;
  budget?: AssetBudget;
}

export interface AssetsAudioSpec {
  defaultProvider?: string;
  budget?: AssetBudget;
}

export interface AssetsSpec {
  image?: AssetsImageSpec;
  audio?: AssetsAudioSpec;
}

// ---------------------------------------------------------------------------
// Classification (natural language → project spec)
// ---------------------------------------------------------------------------

export interface ProjectSpec {
  /** Matches a `recipes/<type>/` directory. */
  type: string;
  features: string[];
  complexity: 'simple' | 'medium' | 'complex';
  /** Short slug derived from the request, used as project id. */
  slug: string;
  rawRequest: string;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export interface SprintReport {
  iteration: number;
  testReport?: TestReport;
  reviewFindings: ReviewFinding[];
  completion?: CompletionScore;
  errors: string[];
}

export interface OrchestratorInput {
  request: string;
  /** If omitted, the classifier runs first. */
  typeHint?: string;
  maxIterations?: number;
}

export interface OrchestratorReport {
  projectId: string;
  workspaceDir: string;
  summary: string;
  completion: CompletionScore;
  iterations: SprintReport[];
  halted: boolean;
  haltReason?: string;
}

// ---------------------------------------------------------------------------
// Circuit breaker (R4)
// ---------------------------------------------------------------------------

export interface CircuitBreakerConfig {
  maxIterations: number;
  repeatedErrorThreshold: number;
}

export interface CircuitBreakerState {
  iteration: number;
  lastErrorSignature?: string;
  repeatedErrorCount: number;
  tripped: boolean;
  tripReason?: string;
}

// ---------------------------------------------------------------------------
// Metrics (R5)
// ---------------------------------------------------------------------------

export interface MetricRecord {
  ts: string; // ISO-8601
  projectId: string;
  role: AgentRole | 'orchestrator' | 'classifier' | 'meta';
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  durationMs: number;
  /** Command or step label for correlating with workspace events. */
  step: string;
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

export interface Logger {
  trace(msg: string, data?: Record<string, unknown>): void;
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

export interface WorkspaceHandle {
  projectId: string;
  /** Absolute path to the isolated worktree. */
  dir: string;
  /** Branch name the worktree was created on. */
  branch: string;
  cleanup(): Promise<void>;
}
