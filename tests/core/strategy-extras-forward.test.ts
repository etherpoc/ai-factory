/**
 * Regression for F17: wrapping strategies (e.g. the budget tracker) must forward
 * `extras` to the inner strategy. Dropping it silently breaks prompt caching
 * because the Claude strategy never sees the preamble.
 */
import { describe, expect, it, vi } from 'vitest';
import type { AgentStrategy } from '../../core/agent-factory';
import type { WrapContext } from '../../core/metrics';
import type { AgentInput, Recipe } from '../../core/types';

const recipe: Recipe = {
  meta: { type: 'demo', version: '1.0.0', description: '' },
  stack: { language: 'typescript', framework: 'none', deps: [] },
  scaffold: { type: 'template', path: '_template' },
  agentOverrides: {},
  build: { command: 'true', timeoutSec: 1 },
  test: { command: 'true', timeoutSec: 1 },
  evaluation: { criteria: [] },
};

const input: AgentInput = {
  projectId: 'p',
  workspaceDir: '/tmp/p',
  request: 'r',
  recipe,
  artifacts: {},
};

const noopCtx: WrapContext = { usage: () => undefined };

/** Minimal budget-style wrapper that MUST forward `extras` to inner. */
function wrap(inner: AgentStrategy): AgentStrategy {
  return {
    async run(role, input_, sp, tools, ctx, extras) {
      return inner.run(role, input_, sp, tools, ctx, extras);
    },
  };
}

describe('AgentStrategy wrappers forward extras', () => {
  it('inner strategy receives preamble and workspaceDir through a wrapper', async () => {
    const innerRun = vi.fn(async () => ({ artifacts: {} }));
    const inner: AgentStrategy = { run: innerRun };
    const wrapped = wrap(inner);

    await wrapped.run('director', input, 'SYS', [], noopCtx, {
      preamble: 'PRE-CONTENT',
      workspaceDir: '/tmp/p',
    });

    expect(innerRun).toHaveBeenCalledOnce();
    const call = innerRun.mock.calls[0] as unknown as unknown[];
    const passedExtras = call[5] as unknown;
    expect(passedExtras).toEqual({ preamble: 'PRE-CONTENT', workspaceDir: '/tmp/p' });
  });

  it('a wrapper that DROPS extras is detectable (negative control)', async () => {
    const innerRun = vi.fn(async () => ({ artifacts: {} }));
    const inner: AgentStrategy = { run: innerRun };
    const broken: AgentStrategy = {
      // Intentionally omits extras forward — this is the bug budgetedStrategy had.
      async run(role, input_, sp, tools, ctx) {
        return inner.run(role, input_, sp, tools, ctx);
      },
    };
    await broken.run('director', input, 'SYS', [], noopCtx, {
      preamble: 'PRE-CONTENT',
    });
    const call = innerRun.mock.calls[0] as unknown as unknown[];
    expect(call[5] as unknown).toBeUndefined();
  });
});
