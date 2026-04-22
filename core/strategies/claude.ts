import Anthropic from '@anthropic-ai/sdk';
import type {
  ContentBlock,
  Message,
  MessageParam,
  TextBlock,
  Tool as SdkToolDef,
  ToolUseBlock,
} from '@anthropic-ai/sdk/resources/messages';
import { nullLogger } from '../logger.js';
import type { AgentStrategy } from '../agent-factory.js';
import type {
  AgentInput,
  AgentOutput,
  AgentRole,
  Artifacts,
  CompletionScore,
  Logger,
  ReviewFinding,
  Tool,
  ToolContext,
} from '../types.js';

const MAX_TOOL_ROUNDS = 30;

/**
 * Default model per role (F14 cost-aware). Orchestration roles that write
 * code (Director, Architect, Programmer) use Sonnet 4.6; structured-output
 * roles (Tester, Reviewer, Evaluator) use Haiku 4.5. Opus 4.7 is opt-in via
 * recipe `agentOverrides.<role>.model` or `ClaudeStrategyOptions.modelsByRole`.
 */
export const DEFAULT_MODELS_BY_ROLE: Record<AgentRole, string> = {
  director: 'claude-sonnet-4-6',
  architect: 'claude-sonnet-4-6',
  programmer: 'claude-sonnet-4-6',
  tester: 'claude-haiku-4-5',
  reviewer: 'claude-haiku-4-5',
  evaluator: 'claude-haiku-4-5',
  // Phase 11.a: creative agents. Phase 11.a.6 bump — critic was on Haiku
  // originally but didn't reliably follow the "write_file('critique.md',…)"
  // directive (emitted the review as chat text instead). Sonnet follows
  // tool-use instructions more strictly, which matters here.
  artist: 'claude-sonnet-4-6',
  sound: 'claude-sonnet-4-6',
  writer: 'claude-sonnet-4-6',
  critic: 'claude-sonnet-4-6',
};

export interface ClaudeStrategyOptions {
  /** Anthropic client. If omitted, one is constructed from ANTHROPIC_API_KEY. */
  client?: Anthropic;
  /** Global model fallback. Used when modelsByRole / recipe / env don't specify. */
  model?: string;
  /** Per-role model override. Recipe's `agentOverrides[role].model` still wins. */
  modelsByRole?: Partial<Record<AgentRole, string>>;
  /** Cap per-call output tokens. */
  maxTokens?: number;
  /** Cache the system prompt (prompt-caching). Default: true. */
  cacheSystemPrompt?: boolean;
  /** Called once per tool invocation (F5 observability). */
  onToolCall?: (event: ToolCallEvent) => void;
  /** Called once per raw API response with the full usage object (F4 debugging). */
  onRawUsage?: (event: RawUsageEvent) => void;
  logger?: Logger;
}

export interface ToolCallEvent {
  role: AgentRole;
  tool: string;
  durationMs: number;
  ok: boolean;
  argsSummary: string;
  errorSummary?: string;
}

export interface RawUsageEvent {
  role: AgentRole;
  round: number;
  model: string;
  usage: unknown;
  stopReason: string | null;
}

/**
 * Strategy that talks to Claude via the base Anthropic SDK, with full tool-use
 * loop support (F5). Tools are supplied by agent-factory via the second argument
 * of strategy.run.
 */
export function createClaudeStrategy(opts: ClaudeStrategyOptions = {}): AgentStrategy {
  const client = opts.client ?? new Anthropic();
  const maxTokens = opts.maxTokens ?? 8000;
  const cache = opts.cacheSystemPrompt ?? true;
  const onToolCall = opts.onToolCall;
  const onRawUsage = opts.onRawUsage;
  const logger = opts.logger ?? nullLogger;

  return {
    async run(role, input, systemPrompt, tools, ctx, extras) {
      const model = resolveModel(role, input.recipe.agentOverrides[role]?.model, opts);
      const userContent = renderUserMessage(input);
      const preamble = extras?.preamble ?? '';
      const system = buildSystem(preamble, systemPrompt, cache);
      const sdkTools = tools.length > 0 ? tools.map(toSdkToolDef) : undefined;
      const toolsByName = new Map(tools.map((t) => [t.name, t]));
      const toolCtx: ToolContext = {
        workspaceDir: extras?.workspaceDir ?? input.workspaceDir,
        projectId: input.projectId,
        logger,
      };

      const totals = {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
      };
      const messages: MessageParam[] = [{ role: 'user', content: userContent }];
      let lastResponse: Message | undefined;

      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const response: Message = await client.messages.create({
          model,
          max_tokens: maxTokens,
          system,
          messages,
          ...(sdkTools ? { tools: sdkTools } : {}),
        });
        lastResponse = response;
        totals.input += response.usage.input_tokens ?? 0;
        totals.output += response.usage.output_tokens ?? 0;
        totals.cacheRead += response.usage.cache_read_input_tokens ?? 0;
        totals.cacheWrite += response.usage.cache_creation_input_tokens ?? 0;

        onRawUsage?.({
          role,
          round,
          model,
          usage: response.usage,
          stopReason: response.stop_reason,
        });

        if (response.stop_reason !== 'tool_use') break;

        const toolUses = response.content.filter(isToolUseBlock);
        if (toolUses.length === 0) break;

        messages.push({ role: 'assistant', content: response.content });

        const resultBlocks = await Promise.all(
          toolUses.map(async (tu) => {
            const impl = toolsByName.get(tu.name);
            const args = (
              typeof tu.input === 'object' && tu.input !== null ? tu.input : {}
            ) as Record<string, unknown>;
            const argsSummary = summarizeArgs(tu.name, args);
            if (!impl) {
              onToolCall?.({
                role,
                tool: tu.name,
                durationMs: 0,
                ok: false,
                argsSummary,
                errorSummary: 'unknown tool',
              });
              return {
                type: 'tool_result' as const,
                tool_use_id: tu.id,
                content: `unknown tool: ${tu.name}`,
                is_error: true,
              };
            }
            const start = Date.now();
            const result = await impl.run(args, toolCtx);
            const durationMs = Date.now() - start;
            onToolCall?.({
              role,
              tool: tu.name,
              durationMs,
              ok: result.ok,
              argsSummary,
              ...(result.ok ? {} : { errorSummary: truncate(result.error, 200) }),
            });
            return result.ok
              ? {
                  type: 'tool_result' as const,
                  tool_use_id: tu.id,
                  content: stringifyOutput(result.output),
                }
              : {
                  type: 'tool_result' as const,
                  tool_use_id: tu.id,
                  content: result.error,
                  is_error: true,
                };
          }),
        );

        messages.push({ role: 'user', content: resultBlocks });
      }

      ctx.usage({
        inputTokens: totals.input,
        outputTokens: totals.output,
        cacheReadTokens: totals.cacheRead,
        cacheCreationTokens: totals.cacheWrite,
        model,
      });

      const text = lastResponse ? extractText(lastResponse) : '';
      return parseResponse(input.recipe.meta.type, role, text);
    },
  };
}

// ---------------------------------------------------------------------------
// Model resolution
// ---------------------------------------------------------------------------

function resolveModel(
  role: AgentRole,
  recipeModel: string | undefined,
  opts: ClaudeStrategyOptions,
): string {
  const resolved =
    recipeModel ??
    opts.modelsByRole?.[role] ??
    opts.model ??
    process.env.UAF_DEFAULT_MODEL ??
    DEFAULT_MODELS_BY_ROLE[role];

  // Opus must be explicit opt-in (F18). Recipe-level override, `modelsByRole`,
  // `opts.model`, and `UAF_DEFAULT_MODEL` all count as explicit; default
  // resolution via `DEFAULT_MODELS_BY_ROLE` never returns an Opus model, so
  // if we see Opus here it came from one of the explicit sources — log it.
  if (/opus/i.test(resolved) && opts.logger) {
    opts.logger.warn('claude: Opus model selected (opt-in)', {
      role,
      model: resolved,
      source:
        recipeModel === resolved
          ? 'recipe.agentOverrides'
          : opts.modelsByRole?.[role] === resolved
            ? 'ClaudeStrategyOptions.modelsByRole'
            : opts.model === resolved
              ? 'ClaudeStrategyOptions.model'
              : process.env.UAF_DEFAULT_MODEL === resolved
                ? 'UAF_DEFAULT_MODEL env'
                : 'unknown (investigate)',
    });
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Tool helpers
// ---------------------------------------------------------------------------

function isToolUseBlock(b: ContentBlock): b is ToolUseBlock {
  return b.type === 'tool_use';
}

function toSdkToolDef(t: Tool): SdkToolDef {
  return {
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as SdkToolDef['input_schema'],
  };
}

function stringifyOutput(output: unknown): string {
  if (typeof output === 'string') return truncate(output, 40_000);
  try {
    return truncate(JSON.stringify(output), 40_000);
  } catch {
    return String(output);
  }
}

function summarizeArgs(tool: string, args: Record<string, unknown>): string {
  switch (tool) {
    case 'read_file':
    case 'list_dir':
      return String(args.path ?? '');
    case 'write_file':
      return `${String(args.path ?? '')} (${String(args.content).length} chars)`;
    case 'edit_file':
      return `${String(args.path ?? '')} (replace ${String(args.old_string).length} → ${String(args.new_string).length} chars)`;
    case 'bash':
      return truncate(String(args.command ?? ''), 80);
    default:
      return truncate(JSON.stringify(args), 80);
  }
}

// ---------------------------------------------------------------------------
// System prompt builder (F4 prompt caching)
// ---------------------------------------------------------------------------

function buildSystem(
  preamble: string,
  rolePrompt: string,
  cache: boolean,
): string | Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }> {
  const hasPreamble = preamble.trim().length > 0;
  if (!hasPreamble) {
    return cache
      ? [{ type: 'text', text: rolePrompt, cache_control: { type: 'ephemeral' } }]
      : rolePrompt;
  }
  return [
    cache
      ? { type: 'text', text: preamble, cache_control: { type: 'ephemeral' } }
      : { type: 'text', text: preamble },
    { type: 'text', text: rolePrompt },
  ];
}

// ---------------------------------------------------------------------------
// Prompt rendering
// ---------------------------------------------------------------------------

function renderUserMessage(input: AgentInput): string {
  const parts: string[] = [];
  parts.push(`# ユーザーリクエスト\n${input.request}`);
  parts.push(`# プロジェクト情報\n- id: ${input.projectId}\n- workspace: ${input.workspaceDir}`);
  parts.push(`# Recipe\n${summarizeRecipe(input.recipe.meta.type, input.recipe)}`);
  if (input.artifacts.spec) parts.push(`# 既存 spec.md\n${input.artifacts.spec}`);
  if (input.artifacts.design) parts.push(`# 既存 design.md\n${input.artifacts.design}`);
  if (input.artifacts.changedFiles?.length) {
    parts.push(`# 変更ファイル\n${input.artifacts.changedFiles.join('\n')}`);
  }
  if (input.artifacts.testReport) {
    parts.push(`# テスト結果\n${JSON.stringify(input.artifacts.testReport, null, 2)}`);
  }
  if (input.previous) {
    parts.push(`# 前回スプリント\n${JSON.stringify(input.previous, null, 2)}`);
  }
  return parts.join('\n\n');
}

function summarizeRecipe(type: string, recipe: AgentInput['recipe']): string {
  return [
    `type: ${type}`,
    `stack: ${recipe.stack.language} / ${recipe.stack.framework}`,
    `build: ${recipe.build.command}`,
    `test: ${recipe.test.command}`,
    `criteria: ${recipe.evaluation.criteria.map((c) => c.id).join(', ') || '(none)'}`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

function extractText(msg: Message): string {
  return msg.content
    .filter((b): b is TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

function parseResponse(
  _recipeType: string,
  role: AgentRole,
  text: string,
): Omit<AgentOutput, 'role' | 'metrics'> {
  const artifacts: Partial<Artifacts> = {};
  switch (role) {
    case 'director':
      artifacts.spec = text;
      artifacts.tasks = extractTasksFromSpec(text);
      return { artifacts };
    case 'architect':
      artifacts.design = text;
      return { artifacts };
    case 'programmer':
    case 'tester':
      // Tool-use did the actual work; the final text is a summary. Record it in notes.
      return { artifacts: {}, notes: truncate(text, 800) };
    case 'reviewer':
      artifacts.reviewFindings = parseFindings(text);
      return { artifacts };
    case 'evaluator':
      artifacts.completion = parseCompletion(text);
      return { artifacts };
    case 'artist':
    case 'sound':
    case 'writer':
    case 'critic':
      // Phase 11.a creative agents: their real output is files they wrote
      // via tools (assets/*, copy.json, critique.md). The text response is
      // a plain summary — record it as notes for the orchestrator to surface.
      return { artifacts: {}, notes: truncate(text, 800) };
  }
}

function extractTasksFromSpec(md: string): string[] {
  const lines = md.split('\n');
  const start = lines.findIndex((l) => /^#{1,6}\s*.*タスク/.test(l));
  if (start < 0) return [];
  const tasks: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) break;
    if (/^#{1,6}\s/.test(line)) break;
    const m = /^\s*-\s*(?:\[ \]\s*)?(.+?)\s*$/.exec(line);
    if (m && m[1]) tasks.push(m[1]);
  }
  return tasks;
}

function parseFindings(text: string): ReviewFinding[] {
  const json = extractJson(text);
  if (!Array.isArray(json)) return [];
  return json.filter(isFinding);
}

function parseCompletion(text: string): CompletionScore {
  const json = extractJson(text);
  if (!isCompletionScore(json)) {
    return { overall: 0, perCriterion: [], done: false };
  }
  return json;
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/.exec(trimmed);
  const candidate = fenced?.[1] ?? trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const match = /[[{][\s\S]*[\]}]/.exec(candidate);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function isFinding(v: unknown): v is ReviewFinding {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.file === 'string' &&
    typeof r.message === 'string' &&
    (r.severity === 'info' || r.severity === 'warn' || r.severity === 'error')
  );
}

function isCompletionScore(v: unknown): v is CompletionScore {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.overall === 'number' && Array.isArray(r.perCriterion) && typeof r.done === 'boolean'
  );
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

// Exported for tests
export const __internal = {
  extractTasksFromSpec,
  parseFindings,
  parseCompletion,
  extractJson,
  parseResponse,
  buildSystem,
};
