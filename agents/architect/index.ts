import { createAgent, type CreateAgentOptions } from '../../core/agent-factory.js';
import type { Agent } from '../../core/types.js';

export type CreateArchitectOptions = Omit<CreateAgentOptions, 'role'>;

export function createArchitectAgent(opts: CreateArchitectOptions): Promise<Agent> {
  return createAgent({ ...opts, role: 'architect' });
}
