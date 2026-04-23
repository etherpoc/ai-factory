import { createAgent, type CreateAgentOptions } from '../../core/agent-factory.js';
import type { Agent, Recipe, Tool } from '../../core/types.js';
import type { MetricsRecorder } from '../../core/metrics.js';
import type { AgentStrategy } from '../../core/agent-factory.js';

export type CreateInterviewerOptions = Omit<CreateAgentOptions, 'role'>;

export function createInterviewerAgent(opts: CreateInterviewerOptions): Promise<Agent> {
  return createAgent({ ...opts, role: 'interviewer' });
}

/**
 * Revise-mode invocation (Phase 7.8.9).
 *
 * Drives the interviewer in REVISE mode: the user has an existing spec.md
 * and a free-form modification request; the agent should rewrite only the
 * affected sections (leaving everything else verbatim) and overwrite spec.md
 * via the write_file tool.
 *
 * Caller must supply a toolRegistry containing `ask_user` and `write_file`
 * (the same setup the interviewer uses in create mode). The current spec
 * content is passed via `input.artifacts.spec`; the claude strategy
 * surfaces it to the LLM under a "# 既存 spec.md" heading.
 */
export interface ReviseSpecOptions {
  recipe: Recipe;
  metrics: MetricsRecorder;
  projectId: string;
  workspaceDir: string;
  currentSpec: string;
  revisionRequest: string;
  strategy: AgentStrategy;
  toolRegistry: ReadonlyMap<string, Tool>;
  repoRoot?: string;
}

export const REVISE_MODE_MARKER = '[REVISE MODE]';

export async function reviseSpecViaInterviewer(opts: ReviseSpecOptions): Promise<void> {
  const agent = await createInterviewerAgent({
    recipe: opts.recipe,
    metrics: opts.metrics,
    strategy: opts.strategy,
    toolRegistry: opts.toolRegistry,
    ...(opts.repoRoot !== undefined ? { repoRoot: opts.repoRoot } : {}),
  });
  await agent.invoke({
    projectId: opts.projectId,
    workspaceDir: opts.workspaceDir,
    request: `${REVISE_MODE_MARKER}\n\n修正指示: ${opts.revisionRequest}`,
    recipe: opts.recipe,
    artifacts: { spec: opts.currentSpec },
  });
}
