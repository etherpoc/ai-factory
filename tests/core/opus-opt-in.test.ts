/**
 * F18 regression: Opus models must only be reachable via explicit opt-in sources
 * (recipe.agentOverrides[role].model, ClaudeStrategyOptions.modelsByRole,
 *  ClaudeStrategyOptions.model, or UAF_DEFAULT_MODEL env). The default
 * resolution via DEFAULT_MODELS_BY_ROLE MUST NOT return Opus.
 *
 * Covers: grep-level source audit + unit-level verification that the defaults
 * are Sonnet / Haiku only, and that the `claude: Opus model selected (opt-in)`
 * warning fires when Opus is chosen.
 */
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_MODELS_BY_ROLE, createClaudeStrategy } from '../../core/strategies/claude';
import type { AgentRole, Logger, Recipe } from '../../core/types';
import type { WrapContext } from '../../core/metrics';

const ROLES: AgentRole[] = [
  'director',
  'architect',
  'programmer',
  'tester',
  'reviewer',
  'evaluator',
];

describe('F18 — Opus opt-in', () => {
  it('DEFAULT_MODELS_BY_ROLE contains NO Opus entry for any role', () => {
    for (const role of ROLES) {
      expect(DEFAULT_MODELS_BY_ROLE[role].toLowerCase()).not.toContain('opus');
    }
  });

  it('every default model is either Sonnet 4.6 or Haiku 4.5', () => {
    for (const role of ROLES) {
      expect(DEFAULT_MODELS_BY_ROLE[role]).toMatch(/^claude-(sonnet-4-6|haiku-4-5)$/);
    }
  });

  it('logs a warning when Opus is resolved via explicit opt-in', async () => {
    const logger: Logger = {
      trace: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const create = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    });
    const fakeClient = { messages: { create } } as unknown as ConstructorParameters<
      typeof import('@anthropic-ai/sdk').default
    >[0] extends never
      ? never
      : import('@anthropic-ai/sdk').default;

    const strategy = createClaudeStrategy({
      client: fakeClient,
      model: 'claude-opus-4-7',
      logger,
    });

    const recipe: Recipe = {
      meta: { type: 'demo', version: '1.0.0', description: '' },
      stack: { language: 'typescript', framework: 'none', deps: [] },
      scaffold: { type: 'template', path: 't' },
      agentOverrides: {},
      build: { command: 'true', timeoutSec: 1 },
      test: { command: 'true', timeoutSec: 1 },
      evaluation: { criteria: [] },
    };

    const ctx: WrapContext = { usage: vi.fn() };
    await strategy.run(
      'director',
      { projectId: 'p', workspaceDir: '/tmp/p', request: 'x', recipe, artifacts: {} },
      'SYS',
      [],
      ctx,
    );

    // Warning fired with source attribution
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Opus'),
      expect.objectContaining({
        role: 'director',
        model: 'claude-opus-4-7',
        source: 'ClaudeStrategyOptions.model',
      }),
    );
  });

  it('does NOT warn for Sonnet/Haiku default resolution', async () => {
    const logger: Logger = {
      trace: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const create = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    });
    const fakeClient = { messages: { create } } as unknown as ConstructorParameters<
      typeof import('@anthropic-ai/sdk').default
    >[0] extends never
      ? never
      : import('@anthropic-ai/sdk').default;

    const strategy = createClaudeStrategy({ client: fakeClient, logger });
    const recipe: Recipe = {
      meta: { type: 'demo', version: '1.0.0', description: '' },
      stack: { language: 'typescript', framework: 'none', deps: [] },
      scaffold: { type: 'template', path: 't' },
      agentOverrides: {},
      build: { command: 'true', timeoutSec: 1 },
      test: { command: 'true', timeoutSec: 1 },
      evaluation: { criteria: [] },
    };
    const ctx: WrapContext = { usage: vi.fn() };

    for (const role of ROLES) {
      await strategy.run(
        role,
        { projectId: 'p', workspaceDir: '/tmp/p', request: 'x', recipe, artifacts: {} },
        'SYS',
        [],
        ctx,
      );
    }

    expect(logger.warn).not.toHaveBeenCalled();
  });
});
