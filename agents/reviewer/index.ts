import { createAgent, type CreateAgentOptions } from '../../core/agent-factory.js';
import type { Agent } from '../../core/types.js';

export type CreateReviewerOptions = Omit<CreateAgentOptions, 'role'>;

export function createReviewerAgent(opts: CreateReviewerOptions): Promise<Agent> {
  return createAgent({ ...opts, role: 'reviewer' });
}
