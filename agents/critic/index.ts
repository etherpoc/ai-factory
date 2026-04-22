import { createAgent, type CreateAgentOptions } from '../../core/agent-factory.js';
import type { Agent } from '../../core/types.js';

export type CreateCriticOptions = Omit<CreateAgentOptions, 'role'>;

export function createCriticAgent(opts: CreateCriticOptions): Promise<Agent> {
  return createAgent({ ...opts, role: 'critic' });
}
