import type { Agent, AgentRole, Recipe, Tool } from '../core/types.js';
import type { MetricsRecorder } from '../core/metrics.js';
import type { AgentStrategy } from '../core/agent-factory.js';
import { createAgent } from '../core/agent-factory.js';

export type AgentMap = Record<AgentRole, Agent>;

export interface CreateAllAgentsOptions {
  recipe: Recipe;
  metrics: MetricsRecorder;
  repoRoot?: string;
  strategy?: AgentStrategy;
  toolRegistry?: ReadonlyMap<string, Tool>;
  model?: string;
}

const ROLES: readonly AgentRole[] = [
  'director',
  'architect',
  'programmer',
  'tester',
  'reviewer',
  'evaluator',
  // Phase 11.a creative agents — always constructed so the map shape is
  // uniform, but the orchestrator only invokes the ones declared in the
  // recipe's `agents` section.
  'artist',
  'sound',
  'writer',
  'critic',
];

/**
 * Build the full agent set for a recipe. Each agent's system prompt is the
 * `agents/<role>/prompt.md` file combined with `recipe.agentOverrides[role].promptAppend`.
 */
export async function createAllAgents(opts: CreateAllAgentsOptions): Promise<AgentMap> {
  const entries = await Promise.all(
    ROLES.map(async (role) => [role, await createAgent({ ...opts, role })] as const),
  );
  return Object.fromEntries(entries) as AgentMap;
}

export { createDirectorAgent } from './director/index.js';
export { createArchitectAgent } from './architect/index.js';
export { createProgrammerAgent } from './programmer/index.js';
export { createTesterAgent } from './tester/index.js';
export { createReviewerAgent } from './reviewer/index.js';
export { createEvaluatorAgent } from './evaluator/index.js';
export { createArtistAgent } from './artist/index.js';
export { createSoundAgent } from './sound/index.js';
export { createWriterAgent } from './writer/index.js';
export { createCriticAgent } from './critic/index.js';
