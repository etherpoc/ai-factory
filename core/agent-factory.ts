import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Agent, AgentInput, AgentOutput, AgentRole, Recipe, Tool } from './types.js';
import type { MetricsRecorder, WrapContext } from './metrics.js';
import { resolveTools as resolveToolsForRole } from './tools/index.js';

/**
 * Pure function that turns (role, input, prompt, tools) into an AgentOutput.
 * The `ctx.usage(...)` callback must be invoked to record LLM token usage.
 *
 * `extras.preamble` is the shared UAF preamble that strategies SHOULD send as
 * a separately-cacheable system block (F4 prompt caching).
 *
 * `extras.workspaceDir` gives tools the allowed write root.
 */
export interface AgentStrategy {
  run(
    role: AgentRole,
    input: AgentInput,
    systemPrompt: string,
    tools: readonly Tool[],
    ctx: WrapContext,
    extras?: { preamble?: string; workspaceDir?: string },
  ): Promise<Omit<AgentOutput, 'role' | 'metrics'>>;
}

export interface CreateAgentOptions {
  role: AgentRole;
  recipe: Recipe;
  metrics: MetricsRecorder;
  /** Override the default `<repoRoot>/agents/<role>/prompt.md` location. */
  promptsDir?: string;
  /** Override repoRoot used to derive `promptsDir`. Defaults to process.cwd(). */
  repoRoot?: string;
  strategy?: AgentStrategy;
  toolRegistry?: ReadonlyMap<string, Tool>;
  model?: string;
  /**
   * Override the common preamble. If omitted, reads `<repoRoot>/agents/_common-preamble.md`
   * (may be empty string if missing). The preamble is sent as a separately-cacheable
   * system block via the strategy's `extras.preamble`.
   */
  preamble?: string;
}

/**
 * Default strategy — emits an empty artifact output so the orchestrator can be
 * wired end-to-end before real LLM calls exist. Phase 2 replaces this.
 */
export const stubStrategy: AgentStrategy = {
  async run(role, input, systemPrompt, _tools, _ctx, extras) {
    const preTag = extras?.preamble ? `+preamble(${extras.preamble.length})` : '';
    return {
      artifacts: {},
      notes: `[stub:${role}:${input.recipe.meta.type}] systemPrompt ${systemPrompt.length} chars${preTag}`,
    };
  },
};

export async function createAgent(opts: CreateAgentOptions): Promise<Agent> {
  const repoRoot = resolve(opts.repoRoot ?? process.cwd());
  const promptsDir = opts.promptsDir ?? join(repoRoot, 'agents', opts.role);
  const basePrompt = await readPromptFile(join(promptsDir, 'prompt.md'));
  const override = opts.recipe.agentOverrides[opts.role];
  const systemPrompt = composeSystemPrompt(basePrompt, override?.promptAppend);
  const tools = resolveToolsForRole(opts.role, override?.additionalTools ?? [], opts.toolRegistry);
  const strategy = opts.strategy ?? stubStrategy;
  const model = opts.model ?? process.env.UAF_DEFAULT_MODEL ?? 'n/a';
  const preamble =
    opts.preamble ?? (await readPromptFile(join(repoRoot, 'agents', '_common-preamble.md')));

  const name = `${opts.role}:${opts.recipe.meta.type}`;

  return {
    name,
    role: opts.role,
    systemPrompt,
    tools,
    async invoke(input: AgentInput): Promise<AgentOutput> {
      const partial = await opts.metrics.wrap(
        { step: name, role: opts.role, model },
        async (ctx) => {
          return strategy.run(opts.role, input, systemPrompt, tools, ctx, {
            ...(preamble ? { preamble } : {}),
            workspaceDir: input.workspaceDir,
          });
        },
      );
      return {
        role: opts.role,
        artifacts: partial.artifacts,
        ...(partial.notes !== undefined ? { notes: partial.notes } : {}),
        metrics: [],
      };
    },
  };
}

export function composeSystemPrompt(base: string, append?: string): string {
  const a = base.trim();
  const b = (append ?? '').trim();
  if (!a) return b;
  if (!b) return a;
  return `${a}\n\n---\n\n${b}`;
}

async function readPromptFile(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') return '';
    throw err;
  }
}
