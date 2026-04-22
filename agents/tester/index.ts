import { createAgent, type CreateAgentOptions } from '../../core/agent-factory.js';
import type { Agent } from '../../core/types.js';

export type CreateTesterOptions = Omit<CreateAgentOptions, 'role'>;

export function createTesterAgent(opts: CreateTesterOptions): Promise<Agent> {
  return createAgent({ ...opts, role: 'tester' });
}
