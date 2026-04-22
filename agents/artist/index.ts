import { createAgent, type CreateAgentOptions } from '../../core/agent-factory.js';
import type { Agent } from '../../core/types.js';

export type CreateArtistOptions = Omit<CreateAgentOptions, 'role'>;

export function createArtistAgent(opts: CreateArtistOptions): Promise<Agent> {
  return createAgent({ ...opts, role: 'artist' });
}
