/**
 * Phase 7.8.12 — orchestrator ProgressSink emission tests.
 *
 * Runs the orchestrator end-to-end with stubbed deps (zero LLM cost) and
 * asserts the sequence of events it emits: pre-build phases, sprint stages,
 * hint for build/test, reconcile after scaffold, skipped phases on resume.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { runOrchestrator } from '../../core/orchestrator';
import type {
  Agent,
  AgentInput,
  AgentOutput,
  AgentRole,
  Artifacts,
  ProgressEvent,
  ProgressSink,
  Recipe,
  WorkspaceHandle,
} from '../../core/types';
import { nullLogger } from '../../core/logger';
import { upsertWorkspaceState } from '../../core/state';

function makeRecipe(): Recipe {
  return {
    meta: { type: 'demo', version: '1.0.0', description: 'demo' },
    stack: { language: 'typescript', framework: 'none', deps: [] },
    scaffold: { type: 'template', path: '_template' },
    agentOverrides: {},
    build: { command: 'true', timeoutSec: 10 },
    test: { command: 'true', timeoutSec: 10 },
    evaluation: {
      criteria: [
        { id: 'builds', description: 'builds', required: true },
        { id: 'tests-pass', description: 'tests pass', required: true },
      ],
    },
  };
}

function makeAgent(
  role: AgentRole,
  emit: (input: AgentInput) => Partial<Artifacts> = () => ({}),
): Agent {
  return {
    name: `${role}:demo`,
    role,
    systemPrompt: '',
    tools: [],
    invoke: vi.fn(async (input: AgentInput): Promise<AgentOutput> => ({
      role,
      artifacts: emit(input),
      metrics: [],
    })),
  };
}

function fullAgentMap(partial: Partial<Record<AgentRole, Agent>>): Record<AgentRole, Agent> {
  const all: AgentRole[] = [
    'director',
    'architect',
    'programmer',
    'tester',
    'reviewer',
    'evaluator',
    'artist',
    'sound',
    'writer',
    'critic',
    'interviewer',
    'roadmap-builder',
  ];
  const out: Partial<Record<AgentRole, Agent>> = {};
  for (const r of all) out[r] = partial[r] ?? makeAgent(r);
  return out as Record<AgentRole, Agent>;
}

function recordingSink(): { sink: ProgressSink; events: ProgressEvent[] } {
  const events: ProgressEvent[] = [];
  return {
    events,
    sink: {
      emit(ev) {
        events.push(ev);
      },
    },
  };
}

async function makeWorkspace(): Promise<WorkspaceHandle> {
  const dir = await mkdtemp(join(tmpdir(), 'uaf-progress-'));
  return {
    projectId: 'proj',
    dir,
    branch: 'uaf/test',
    cleanup: vi.fn(async () => undefined),
  };
}

describe('orchestrator — ProgressSink', () => {
  it('emits phase/sprint events in the expected order for a happy-path run', async () => {
    const recipe = makeRecipe();
    const handle = await makeWorkspace();
    const { sink, events } = recordingSink();

    try {
      await runOrchestrator({
        request: 'make a thing',
        typeHint: 'demo',
        logger: nullLogger,
        keepWorkspace: true,
        progressSink: sink,
        deps: {
          classify: async (req, t) => ({
            type: t ?? 'demo',
            features: [],
            complexity: 'simple',
            slug: 'fake',
            rawRequest: req,
          }),
          loadRecipe: async () => recipe,
          createWorkspace: async () => handle,
          makeAgents: async () =>
            fullAgentMap({
              director: makeAgent('director', () => ({ spec: '# spec' })),
              architect: makeAgent('architect', () => ({ design: '# design' })),
              programmer: makeAgent('programmer', () => ({ changedFiles: ['a.ts'] })),
              tester: makeAgent('tester'),
              reviewer: makeAgent('reviewer', () => ({ reviewFindings: [] })),
              evaluator: makeAgent('evaluator'),
            }),
          scaffold: async () => undefined,
          build: async () => ({ ok: true, output: '' }),
          runTests: async () => ({ passed: 3, failed: 0, durationMs: 10, failures: [] }),
        },
      });
    } finally {
      await rm(handle.dir, { recursive: true, force: true });
    }

    const kinds = events.map((e) => e.kind);
    // Pre-sprint phases emit start/end pairs
    expect(kinds).toContain('phase-start');
    expect(kinds).toContain('phase-end');
    // At least one sprint runs to completion
    expect(kinds).toContain('sprint-start');
    expect(kinds).toContain('sprint-end');
    // All six sprint stages should fire start+end (done=true on first sprint)
    const stageStarts = events.filter((e) => e.kind === 'sprint-stage-start');
    expect(stageStarts.map((e) => (e.kind === 'sprint-stage-start' ? e.stage : null))).toEqual([
      'programmer',
      'build',
      'tester',
      'reviewer',
      'evaluator',
    ]);
    // Build + test hints fire inside their stages
    const hints = events.filter((e) => e.kind === 'hint');
    const hintValues = hints.map((h) => (h.kind === 'hint' ? h.hint : null));
    expect(hintValues).toContain('build');
    expect(hintValues).toContain('test');
  });

  it('skips director / architect when spec.md and design.md already exist', async () => {
    const recipe = makeRecipe();
    const handle = await makeWorkspace();
    await writeFile(join(handle.dir, 'spec.md'), '# existing spec', 'utf8');
    await writeFile(join(handle.dir, 'design.md'), '# existing design', 'utf8');
    const { sink, events } = recordingSink();

    try {
      await runOrchestrator({
        request: 'r',
        typeHint: 'demo',
        logger: nullLogger,
        keepWorkspace: true,
        progressSink: sink,
        existingWorkspace: handle,
        skipScaffold: true,
        deps: {
          classify: async (req, t) => ({
            type: t ?? 'demo',
            features: [],
            complexity: 'simple',
            slug: 'fake',
            rawRequest: req,
          }),
          loadRecipe: async () => recipe,
          makeAgents: async () =>
            fullAgentMap({
              programmer: makeAgent('programmer'),
              tester: makeAgent('tester'),
              reviewer: makeAgent('reviewer', () => ({ reviewFindings: [] })),
              evaluator: makeAgent('evaluator'),
            }),
          build: async () => ({ ok: true, output: '' }),
          runTests: async () => ({ passed: 1, failed: 0, durationMs: 1, failures: [] }),
        },
      });
    } finally {
      await rm(handle.dir, { recursive: true, force: true });
    }

    const skipped = events.filter((e) => e.kind === 'phase-skipped');
    const skippedPhases = skipped.map((e) => (e.kind === 'phase-skipped' ? e.phase : null));
    expect(skippedPhases).toContain('director');
    expect(skippedPhases).toContain('architect');
    expect(skippedPhases).toContain('scaffold');
  });

  it('emits a reconcile event after scaffold with Setup-phase task ids', async () => {
    const recipe = makeRecipe();
    const handle = await makeWorkspace();
    const { sink, events } = recordingSink();

    // Seed state.json with a roadmap having Setup + Core tasks.
    await upsertWorkspaceState(handle.dir, {
      projectId: 'proj',
      recipeType: 'demo',
      originalRequest: 'x',
      status: 'in-progress',
      phase: 'build',
      resumable: true,
      roadmap: {
        path: 'roadmap.md',
        createdAt: new Date().toISOString(),
        totalTasks: 3,
        completedTasks: 0,
        tasks: [
          { id: 'task-001', title: 'scaffold', status: 'pending', phase: 'Setup' },
          { id: 'task-002', title: 'configs', status: 'pending', phase: 'Setup' },
          { id: 'task-003', title: 'logic', status: 'pending', phase: 'Core' },
        ],
      },
    });

    try {
      await runOrchestrator({
        request: 'r',
        typeHint: 'demo',
        logger: nullLogger,
        keepWorkspace: true,
        progressSink: sink,
        existingWorkspace: handle,
        deps: {
          classify: async (req, t) => ({
            type: t ?? 'demo',
            features: [],
            complexity: 'simple',
            slug: 'fake',
            rawRequest: req,
          }),
          loadRecipe: async () => recipe,
          makeAgents: async () =>
            fullAgentMap({
              director: makeAgent('director', () => ({ spec: '# spec' })),
              architect: makeAgent('architect', () => ({ design: '# design' })),
              programmer: makeAgent('programmer'),
              tester: makeAgent('tester'),
              reviewer: makeAgent('reviewer', () => ({ reviewFindings: [] })),
              evaluator: makeAgent('evaluator'),
            }),
          // Real scaffold writes package.json so reconcile finds evidence.
          scaffold: async () => {
            await writeFile(join(handle.dir, 'package.json'), '{}', 'utf8');
          },
          build: async () => ({ ok: true, output: '' }),
          runTests: async () => ({ passed: 1, failed: 0, durationMs: 1, failures: [] }),
        },
      });
    } finally {
      await rm(handle.dir, { recursive: true, force: true });
    }

    const reconcile = events.find((e) => e.kind === 'reconcile');
    expect(reconcile).toBeDefined();
    if (reconcile?.kind === 'reconcile') {
      expect(reconcile.completedTaskIds).toEqual(['task-001', 'task-002']);
      expect(reconcile.warnings).toEqual([]);
    }
  });

  it('reconcile emits a warning when scaffold succeeds but package.json is missing', async () => {
    const recipe = makeRecipe();
    const handle = await makeWorkspace();
    const { sink, events } = recordingSink();
    await upsertWorkspaceState(handle.dir, {
      projectId: 'proj',
      recipeType: 'demo',
      originalRequest: 'x',
      status: 'in-progress',
      phase: 'build',
      resumable: true,
      roadmap: {
        path: 'roadmap.md',
        createdAt: new Date().toISOString(),
        totalTasks: 1,
        completedTasks: 0,
        tasks: [{ id: 'task-001', title: 's', status: 'pending', phase: 'Setup' }],
      },
    });

    try {
      await runOrchestrator({
        request: 'r',
        typeHint: 'demo',
        logger: nullLogger,
        keepWorkspace: true,
        progressSink: sink,
        existingWorkspace: handle,
        deps: {
          classify: async (req, t) => ({
            type: t ?? 'demo',
            features: [],
            complexity: 'simple',
            slug: 'fake',
            rawRequest: req,
          }),
          loadRecipe: async () => recipe,
          makeAgents: async () =>
            fullAgentMap({
              director: makeAgent('director', () => ({ spec: '# spec' })),
              architect: makeAgent('architect', () => ({ design: '# design' })),
              programmer: makeAgent('programmer'),
              tester: makeAgent('tester'),
              reviewer: makeAgent('reviewer', () => ({ reviewFindings: [] })),
              evaluator: makeAgent('evaluator'),
            }),
          scaffold: async () => undefined, // deliberately no package.json
          build: async () => ({ ok: true, output: '' }),
          runTests: async () => ({ passed: 1, failed: 0, durationMs: 1, failures: [] }),
        },
      });
    } finally {
      await rm(handle.dir, { recursive: true, force: true });
    }

    const rec = events.find((e) => e.kind === 'reconcile');
    expect(rec).toBeDefined();
    if (rec?.kind === 'reconcile') {
      expect(rec.completedTaskIds).toEqual([]);
      expect(rec.warnings.join(' ')).toContain('package.json');
    }
  });
});
