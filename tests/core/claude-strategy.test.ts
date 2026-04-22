import { describe, expect, it, vi } from 'vitest';
import { createClaudeStrategy, __internal } from '../../core/strategies/claude';
import type { AgentInput, Recipe } from '../../core/types';
import type { WrapContext } from '../../core/metrics';

const recipe: Recipe = {
  meta: { type: 'demo', version: '1.0.0', description: '' },
  stack: { language: 'typescript', framework: 'none', deps: [] },
  scaffold: { type: 'template', path: '_template' },
  agentOverrides: {},
  build: { command: 'true', timeoutSec: 1 },
  test: { command: 'true', timeoutSec: 1 },
  evaluation: { criteria: [] },
};

function baseInput(overrides: Partial<AgentInput> = {}): AgentInput {
  return {
    projectId: 'p',
    workspaceDir: '/tmp/p',
    request: 'make a thing',
    recipe,
    artifacts: {},
    ...overrides,
  };
}

function noopCtx(): WrapContext {
  return { usage: vi.fn() };
}

describe('claude strategy internals', () => {
  it('extractTasksFromSpec reads checklist under ## タスク', () => {
    const md = [
      '# header',
      '## 今スプリントのタスク',
      '- [ ] first task',
      '- [ ] second task',
      '- not a task? still captured',
      '## 別見出し',
      '- should not appear',
    ].join('\n');
    expect(__internal.extractTasksFromSpec(md)).toEqual([
      'first task',
      'second task',
      'not a task? still captured',
    ]);
  });

  it('extractJson handles fenced ```json blocks and bare JSON', () => {
    const fenced = '```json\n{"overall":80,"perCriterion":[],"done":false}\n```';
    expect(__internal.extractJson(fenced)).toEqual({
      overall: 80,
      perCriterion: [],
      done: false,
    });
    const bare = 'prelude [{"file":"a.ts","message":"x","severity":"warn"}] trail';
    expect(__internal.extractJson(bare)).toEqual([
      { file: 'a.ts', message: 'x', severity: 'warn' },
    ]);
    expect(__internal.extractJson('not json at all')).toBeNull();
  });

  it('parseFindings filters invalid entries', () => {
    const ok = '[{"file":"a.ts","line":1,"severity":"warn","message":"m"}]';
    expect(__internal.parseFindings(ok)).toHaveLength(1);
    const bad = '[{"file":"a.ts"}]';
    expect(__internal.parseFindings(bad)).toEqual([]);
  });

  it('buildSystem emits [cached preamble, role prompt] when preamble is present', () => {
    const s = __internal.buildSystem('PREAMBLE with plenty of content', 'ROLE_PROMPT', true);
    expect(Array.isArray(s)).toBe(true);
    if (!Array.isArray(s)) return;
    expect(s[0]).toMatchObject({
      type: 'text',
      text: 'PREAMBLE with plenty of content',
      cache_control: { type: 'ephemeral' },
    });
    expect(s[1]).toMatchObject({ type: 'text', text: 'ROLE_PROMPT' });
    expect('cache_control' in s[1]!).toBe(false);
  });

  it('buildSystem emits only the role prompt when preamble is empty', () => {
    const s = __internal.buildSystem('', 'ONLY_ROLE', true);
    expect(Array.isArray(s)).toBe(true);
    if (!Array.isArray(s)) return;
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ text: 'ONLY_ROLE' });
  });

  it('parseResponse routes based on role', () => {
    expect(__internal.parseResponse('demo', 'director', '# spec\n').artifacts.spec).toBe(
      '# spec\n',
    );
    expect(__internal.parseResponse('demo', 'architect', '# design\n').artifacts.design).toBe(
      '# design\n',
    );
    expect(__internal.parseResponse('demo', 'programmer', 'did stuff').notes).toBe('did stuff');
    expect(
      __internal.parseResponse('demo', 'reviewer', '[{"file":"a","severity":"warn","message":"x"}]')
        .artifacts.reviewFindings,
    ).toHaveLength(1);
    expect(
      __internal.parseResponse('demo', 'evaluator', '{"overall":100,"perCriterion":[],"done":true}')
        .artifacts.completion?.done,
    ).toBe(true);
  });
});

describe('createClaudeStrategy end-to-end (mocked client)', () => {
  it('calls messages.create, records usage, and extracts spec for director', async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: '# spec\n\n## 今スプリントのタスク\n- [ ] a\n' }],
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 100,
        output_tokens: 200,
        cache_read_input_tokens: 50,
        cache_creation_input_tokens: 10,
      },
    });
    const fakeClient = { messages: { create } } as unknown as ConstructorParameters<
      typeof import('@anthropic-ai/sdk').default
    >[0] extends never
      ? never
      : import('@anthropic-ai/sdk').default;

    const strategy = createClaudeStrategy({ client: fakeClient, model: 'claude-opus-4-7' });
    const ctx = noopCtx();
    const out = await strategy.run('director', baseInput(), 'SYSTEM', [], ctx);

    expect(create).toHaveBeenCalledOnce();
    const callArgs = create.mock.calls[0]?.[0];
    expect(callArgs?.model).toBe('claude-opus-4-7');
    expect(Array.isArray(callArgs?.system)).toBe(true);

    expect(ctx.usage).toHaveBeenCalledWith({
      inputTokens: 100,
      outputTokens: 200,
      cacheReadTokens: 50,
      cacheCreationTokens: 10,
      model: 'claude-opus-4-7',
    });

    expect(out.artifacts.spec).toContain('# spec');
    expect(out.artifacts.tasks).toEqual(['a']);
  });
});
