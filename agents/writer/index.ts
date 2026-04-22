import { createAgent, type CreateAgentOptions } from '../../core/agent-factory.js';
import type { Agent } from '../../core/types.js';

export type CreateWriterOptions = Omit<CreateAgentOptions, 'role'>;

export function createWriterAgent(opts: CreateWriterOptions): Promise<Agent> {
  return createAgent({ ...opts, role: 'writer' });
}
