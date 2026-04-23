import { createAgent, type CreateAgentOptions } from '../../core/agent-factory.js';
import type { Agent } from '../../core/types.js';

export type CreateRoadmapBuilderOptions = Omit<CreateAgentOptions, 'role'>;

export function createRoadmapBuilderAgent(opts: CreateRoadmapBuilderOptions): Promise<Agent> {
  return createAgent({ ...opts, role: 'roadmap-builder' });
}
