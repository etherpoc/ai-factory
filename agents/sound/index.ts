import { createAgent, type CreateAgentOptions } from '../../core/agent-factory.js';
import type { Agent } from '../../core/types.js';

export type CreateSoundOptions = Omit<CreateAgentOptions, 'role'>;

export function createSoundAgent(opts: CreateSoundOptions): Promise<Agent> {
  return createAgent({ ...opts, role: 'sound' });
}
