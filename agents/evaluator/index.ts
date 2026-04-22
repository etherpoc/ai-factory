import { createAgent, type CreateAgentOptions } from '../../core/agent-factory.js';
import type { Agent } from '../../core/types.js';

export type CreateEvaluatorOptions = Omit<CreateAgentOptions, 'role'>;

export function createEvaluatorAgent(opts: CreateEvaluatorOptions): Promise<Agent> {
  return createAgent({ ...opts, role: 'evaluator' });
}
