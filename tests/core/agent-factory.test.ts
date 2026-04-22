import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentInput, Recipe, Tool } from '../../core/types';
import { composeSystemPrompt, createAgent, stubStrategy } from '../../core/agent-factory';
import { nullLogger } from '../../core/logger';
import { MetricsRecorder } from '../../core/metrics';

function makeRecipe(overrides: Recipe['agentOverrides'] = {}): Recipe {
  return {
    meta: { type: 'demo', version: '1.0.0', description: 'demo' },
    stack: { language: 'typescript', framework: 'none', deps: [] },
    scaffold: { type: 'template', path: '_template' },
    agentOverrides: overrides,
    build: { command: 'echo build', timeoutSec: 1 },
    test: { command: 'echo test', timeoutSec: 1 },
    evaluation: { criteria: [] },
  };
}

describe('agent-factory', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'uaf-agents-'));
    await mkdir(join(root, 'agents', 'director'), { recursive: true });
    await writeFile(join(root, 'agents', 'director', 'prompt.md'), 'You are the Director.', 'utf8');
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('composes base prompt with promptAppend separator', () => {
    expect(composeSystemPrompt('base', 'extra')).toContain('base\n\n---\n\nextra');
    expect(composeSystemPrompt('base', '')).toBe('base');
    expect(composeSystemPrompt('', 'extra')).toBe('extra');
  });

  it('loads the base prompt from agents/<role>/prompt.md and appends override', async () => {
    const metrics = new MetricsRecorder({ projectId: 'p', dir: root, logger: nullLogger });
    const recipe = makeRecipe({
      director: { promptAppend: 'Follow the 2D game conventions.' },
    });
    const agent = await createAgent({ role: 'director', recipe, metrics, repoRoot: root });
    expect(agent.systemPrompt).toContain('You are the Director.');
    expect(agent.systemPrompt).toContain('Follow the 2D game conventions.');
    expect(agent.role).toBe('director');
    expect(agent.name).toBe('director:demo');
  });

  it('falls back to empty base prompt if prompt.md is missing', async () => {
    const metrics = new MetricsRecorder({ projectId: 'p', dir: root, logger: nullLogger });
    const recipe = makeRecipe();
    const agent = await createAgent({ role: 'tester', recipe, metrics, repoRoot: root });
    expect(agent.systemPrompt).toBe('');
  });

  it('programmer gets the default builtin toolset without any registry', async () => {
    const metrics = new MetricsRecorder({ projectId: 'p', dir: root, logger: nullLogger });
    const recipe = makeRecipe();
    const agent = await createAgent({ role: 'programmer', recipe, metrics, repoRoot: root });
    const names = agent.tools.map((t) => t.name).sort();
    expect(names).toEqual(['bash', 'edit_file', 'list_dir', 'read_file', 'write_file']);
  });

  it('director has no tools (text-only role)', async () => {
    const metrics = new MetricsRecorder({ projectId: 'p', dir: root, logger: nullLogger });
    const recipe = makeRecipe();
    const agent = await createAgent({ role: 'director', recipe, metrics, repoRoot: root });
    expect(agent.tools).toEqual([]);
  });

  it('throws when recipe requests an unknown tool that is not in the registry', async () => {
    const metrics = new MetricsRecorder({ projectId: 'p', dir: root, logger: nullLogger });
    const recipe = makeRecipe({
      programmer: { promptAppend: '', additionalTools: ['no-such-tool'] },
    });
    await expect(
      createAgent({ role: 'programmer', recipe, metrics, repoRoot: root }),
    ).rejects.toThrow(/unknown tool: no-such-tool/);
  });

  it('extends the default toolset with a custom registry tool', async () => {
    const metrics = new MetricsRecorder({ projectId: 'p', dir: root, logger: nullLogger });
    const recipe = makeRecipe({
      programmer: { promptAppend: '', additionalTools: ['custom-thing'] },
    });
    const custom: Tool = {
      name: 'custom-thing',
      description: 'x',
      inputSchema: {},
      run: async () => ({ ok: true, output: '' }),
    };
    const agent = await createAgent({
      role: 'programmer',
      recipe,
      metrics,
      repoRoot: root,
      toolRegistry: new Map<string, Tool>([['custom-thing', custom]]),
    });
    expect(agent.tools.map((t) => t.name)).toContain('custom-thing');
    expect(agent.tools.map((t) => t.name)).toContain('bash');
  });

  it('invoke() runs the supplied strategy and records metrics', async () => {
    const metrics = new MetricsRecorder({ projectId: 'p', dir: root, logger: nullLogger });
    const recipe = makeRecipe();
    const agent = await createAgent({
      role: 'director',
      recipe,
      metrics,
      repoRoot: root,
      strategy: stubStrategy,
    });
    const input: AgentInput = {
      projectId: 'p',
      workspaceDir: root,
      request: 'hi',
      recipe,
      artifacts: {},
    };
    const out = await agent.invoke(input);
    expect(out.role).toBe('director');
    expect(out.notes).toMatch(/\[stub:director:demo\]/);
  });
});
