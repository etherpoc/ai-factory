import { createAgent, type CreateAgentOptions } from '../../core/agent-factory.js';
import type { Agent } from '../../core/types.js';

export type CreateDirectorOptions = Omit<CreateAgentOptions, 'role'>;

export function createDirectorAgent(opts: CreateDirectorOptions): Promise<Agent> {
  return createAgent({ ...opts, role: 'director' });
}
