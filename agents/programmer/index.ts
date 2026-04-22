import { createAgent, type CreateAgentOptions } from '../../core/agent-factory.js';
import type { Agent } from '../../core/types.js';

export type CreateProgrammerOptions = Omit<CreateAgentOptions, 'role'>;

export function createProgrammerAgent(opts: CreateProgrammerOptions): Promise<Agent> {
  return createAgent({ ...opts, role: 'programmer' });
}
