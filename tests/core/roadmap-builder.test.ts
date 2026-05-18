/**
 * Phase 7.8.3 — roadmap-builder unit tests.
 *
 * Covers the parts that don't need a real LLM:
 *   - JSON extraction (fenced, prose-wrapped, strict)
 *   - schema validation (8-15 task hint, but tests pin lower/upper bounds)
 *   - topological sort: stable order, cycle detection, dangling refs, dups
 *   - end-to-end with a fake strategy that emits a JSON envelope
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RoadmapBuilderError,
  buildRoadmap,
  parseRoadmapJson,
  topologicalSort,
} from '../../core/roadmap-builder.js';
import { MetricsRecorder } from '../../core/metrics.js';
import { nullLogger } from '../../core/logger.js';
import type { AgentStrategy } from '../../core/agent-factory.js';
import type { Recipe, Tool, ToolContext } from '../../core/types.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

let repoRoot: string;
let workspace: string;

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'uaf-rb-repo-'));
  await mkdir(join(repoRoot, 'agents', 'roadmap-builder'), { recursive: true });
  await writeFile(
    join(repoRoot, 'agents', 'roadmap-builder', 'prompt.md'),
    'ROADMAP_PROMPT',
    'utf8',
  );
  workspace = await mkdtemp(join(tmpdir(), 'uaf-rb-ws-'));
});
afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true });
  await rm(workspace, { recursive: true, force: true });
});

function recipe(): Recipe {
  return {
    meta: { type: '2d-game', version: '1.0.0', description: 'demo' },
    stack: { language: 'typescript', framework: 'phaser', deps: [] },
    scaffold: { type: 'template', path: '_template' },
    agentOverrides: {},
    build: { command: 'true', timeoutSec: 1 },
    test: { command: 'true', timeoutSec: 1 },
    evaluation: { criteria: [] },
  };
}

// ---------------------------------------------------------------------------
// JSON extraction
// ---------------------------------------------------------------------------

describe('parseRoadmapJson', () => {
  it('parses a strict JSON envelope', () => {
    const v = parseRoadmapJson('{"tasks":[]}');
    expect(v).toEqual({ tasks: [] });
  });

  it('extracts ```json fenced output', () => {
    const text = 'sure thing!\n```json\n{"tasks":[{"id":"task-001","title":"x"}]}\n```';
    expect(parseRoadmapJson(text)).toEqual({
      tasks: [{ id: 'task-001', title: 'x' }],
    });
  });

  it('falls back to first {...} substring', () => {
    const text = 'wrapper {"tasks":[{"id":"task-001","title":"x"}]} trailing';
    expect(parseRoadmapJson(text)).toEqual({
      tasks: [{ id: 'task-001', title: 'x' }],
    });
  });

  it('throws when there is no JSON to extract', () => {
    expect(() => parseRoadmapJson('hello world')).toThrow(RoadmapBuilderError);
  });
});

// ---------------------------------------------------------------------------
// Topological sort
// ---------------------------------------------------------------------------

describe('topologicalSort', () => {
  it('preserves original order when there are no deps', () => {
    expect(
      topologicalSort([{ id: 'a' }, { id: 'b' }, { id: 'c' }]),
    ).toEqual(['a', 'b', 'c']);
  });

  it('respects simple dependencies', () => {
    const order = topologicalSort([
      { id: 'b', dependsOn: ['a'] },
      { id: 'a' },
      { id: 'c', dependsOn: ['b'] },
    ]);
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('c'));
  });

  it('rejects cycles', () => {
    expect(() =>
      topologicalSort([
        { id: 'a', dependsOn: ['b'] },
        { id: 'b', dependsOn: ['a'] },
      ]),
    ).toThrow(/cycle/);
  });

  it('rejects self-dependency', () => {
    expect(() => topologicalSort([{ id: 'a', dependsOn: ['a'] }])).toThrow(/itself/);
  });

  it('rejects unknown dep references', () => {
    expect(() => topologicalSort([{ id: 'a', dependsOn: ['ghost'] }])).toThrow(/unknown task/);
  });

  it('rejects duplicate ids', () => {
    expect(() => topologicalSort([{ id: 'a' }, { id: 'a' }])).toThrow(/duplicate/);
  });

  it('handles diamond DAG', () => {
    // a → b, a → c, b → d, c → d
    const order = topologicalSort([
      { id: 'a' },
      { id: 'b', dependsOn: ['a'] },
      { id: 'c', dependsOn: ['a'] },
      { id: 'd', dependsOn: ['b', 'c'] },
    ]);
    expect(order[0]).toBe('a');
    expect(order[3]).toBe('d');
  });
});

// ---------------------------------------------------------------------------
// End-to-end with a fake strategy
// ---------------------------------------------------------------------------

describe('buildRoadmap — end to end (fake strategy)', () => {
  function fakeStrategy(jsonEnvelope: string): AgentStrategy {
    return {
      async run(_role, _input, _systemPrompt, tools, _ctx, extras) {
        const ws = extras?.workspaceDir ?? '/tmp';
        const writeFileT = tools.find((t) => t.name === 'write_file') as Tool | undefined;
        if (!writeFileT) throw new Error('test setup: write_file missing');
        const ctx: ToolContext = { workspaceDir: ws, projectId: 'p', logger: nullLogger };
        await writeFileT.run(
          { path: 'roadmap.md', content: '# roadmap\n\n- [ ] task-001\n- [ ] task-002\n' },
          ctx,
        );
        return { artifacts: {}, notes: jsonEnvelope };
      },
    };
  }

  function makeMetrics(): MetricsRecorder {
    return new MetricsRecorder({ projectId: 'p', dir: workspace, logger: nullLogger });
  }

  it('builds a sorted RoadmapMeta from a valid envelope', async () => {
    const envelope = JSON.stringify({
      tasks: [
        { id: 'task-001', title: 'Scaffold', phase: 'Setup' },
        { id: 'task-002', title: 'Title scene', phase: 'Core', dependsOn: ['task-001'] },
        { id: 'task-003', title: 'Game scene', phase: 'Core', dependsOn: ['task-002'] },
        { id: 'task-004', title: 'Game over', phase: 'Core', dependsOn: ['task-003'] },
        { id: 'task-005', title: 'Final build', phase: 'Verify', dependsOn: ['task-004'] },
      ],
      estimatedCostUsd: 0.5,
      estimatedDurationMin: 8,
    });
    const result = await buildRoadmap({
      workspaceDir: workspace,
      projectId: 'p',
      request: 'avoid game',
      recipe: recipe(),
      strategy: fakeStrategy(envelope),
      metrics: makeMetrics(),
      repoRoot,
      // Lower the floor so 5 tasks pass for this small fixture.
      minTasks: 4,
    });

    expect(result.roadmap.totalTasks).toBe(5);
    expect(result.roadmap.completedTasks).toBe(0);
    expect(result.roadmap.estimatedCostUsd).toBe(0.5);
    expect(result.roadmap.estimatedDurationMin).toBe(8);
    expect(result.roadmap.tasks.map((t) => t.id)).toEqual([
      'task-001',
      'task-002',
      'task-003',
      'task-004',
      'task-005',
    ]);
    expect(result.roadmap.tasks[0]?.status).toBe('pending');
    expect(result.roadmap.tasks[1]?.metadata?.dependsOn).toEqual(['task-001']);
    expect(await readFile(result.markdownPath, 'utf8')).toContain('# roadmap');
  });

  it('throws when the envelope has too few tasks', async () => {
    const envelope = JSON.stringify({
      tasks: [{ id: 'task-001', title: 'lonely' }],
    });
    await expect(
      buildRoadmap({
        workspaceDir: workspace,
        projectId: 'p',
        request: 'x',
        recipe: recipe(),
        strategy: fakeStrategy(envelope),
        metrics: makeMetrics(),
        repoRoot,
        minTasks: 4,
      }),
    ).rejects.toThrow(/too few tasks/);
  });

  it('throws when roadmap.md was not written', async () => {
    const noWrite: AgentStrategy = {
      async run() {
        return { artifacts: {}, notes: JSON.stringify({ tasks: [] }) };
      },
    };
    await expect(
      buildRoadmap({
        workspaceDir: workspace,
        projectId: 'p',
        request: 'x',
        recipe: recipe(),
        strategy: noWrite,
        metrics: makeMetrics(),
        repoRoot,
      }),
    ).rejects.toThrow(/JSON|roadmap\.md/);
  });

  it('throws on an invalid task id format', async () => {
    const envelope = JSON.stringify({
      tasks: [
        { id: 'bad-id', title: 'x' },
        { id: 'task-002', title: 'y' },
        { id: 'task-003', title: 'z' },
        { id: 'task-004', title: 'w' },
      ],
    });
    await expect(
      buildRoadmap({
        workspaceDir: workspace,
        projectId: 'p',
        request: 'x',
        recipe: recipe(),
        strategy: fakeStrategy(envelope),
        metrics: makeMetrics(),
        repoRoot,
        minTasks: 4,
      }),
    ).rejects.toThrow(/invalid JSON|task-/);
  });

  it('rejects a cyclic dependency graph', async () => {
    const envelope = JSON.stringify({
      tasks: [
        { id: 'task-001', title: 'a', dependsOn: ['task-004'] },
        { id: 'task-002', title: 'b', dependsOn: ['task-001'] },
        { id: 'task-003', title: 'c', dependsOn: ['task-002'] },
        { id: 'task-004', title: 'd', dependsOn: ['task-003'] },
      ],
    });
    await expect(
      buildRoadmap({
        workspaceDir: workspace,
        projectId: 'p',
        request: 'x',
        recipe: recipe(),
        strategy: fakeStrategy(envelope),
        metrics: makeMetrics(),
        repoRoot,
        minTasks: 4,
      }),
    ).rejects.toThrow(/cycle/);
  });
});

// ---------------------------------------------------------------------------
// Phase 7.8.13 — prompt structure guard
//
// The agent historically produced the JSON envelope but skipped
// `write_file('roadmap.md', …)`, which the orchestrator then flagged with
// `roadmap-builder did not produce roadmap.md (write_file was not called)`.
// This mirrors the Phase 11.a.6 Critic regression. Fix was to promote the
// write_file directive to a top-level `必須の出力（最優先）` section so the
// model sees it before the role/format prose. These tests lock that
// structure in so future edits can't accidentally demote it back.
// ---------------------------------------------------------------------------

describe('roadmap-builder prompt structure (Phase 7.8.13)', () => {
  let promptText: string;
  beforeEach(async () => {
    promptText = await readFile(
      join(REPO_ROOT, 'agents', 'roadmap-builder', 'prompt.md'),
      'utf8',
    );
  });

  it('has a top-level "必須の出力（最優先）" section', () => {
    expect(promptText).toMatch(/^##\s+必須の出力（最優先）/m);
  });

  it('places the mandatory-output section before the role section', () => {
    const mandatoryIdx = promptText.indexOf('## 必須の出力（最優先）');
    const roleIdx = promptText.indexOf('## 役割');
    expect(mandatoryIdx).toBeGreaterThan(-1);
    expect(roleIdx).toBeGreaterThan(-1);
    expect(mandatoryIdx).toBeLessThan(roleIdx);
  });

  it("explicitly names write_file('roadmap.md', ...) as required", () => {
    expect(promptText).toMatch(/write_file\(\s*['"]roadmap\.md['"]/);
  });

  it('warns that a JSON-only response is insufficient', () => {
    expect(promptText).toMatch(/テキスト応答|JSON.{0,20}だけ/);
    expect(promptText).toMatch(/halt|責務を果たして/);
  });
});
