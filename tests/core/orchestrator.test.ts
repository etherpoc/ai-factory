import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import type {
  Agent,
  AgentInput,
  AgentOutput,
  AgentRole,
  Artifacts,
  Recipe,
  TestReport,
  WorkspaceHandle,
} from '../../core/types';
import { requestHash, runOrchestrator } from '../../core/orchestrator';
import { nullLogger } from '../../core/logger';

function makeRecipe(overrides: Partial<Recipe> = {}): Recipe {
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
    ...overrides,
  };
}

/**
 * Build a full 10-role agent map from a partial. Missing roles get a no-op
 * stub so the orchestrator's eager createAllAgents signature stays satisfied
 * (the orchestrator only invokes the ones it actually uses).
 */
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
  ];
  const out: Partial<Record<AgentRole, Agent>> = {};
  for (const r of all) out[r] = partial[r] ?? makeAgent(r);
  return out as Record<AgentRole, Agent>;
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
    invoke: vi.fn(async (input: AgentInput): Promise<AgentOutput> => {
      return { role, artifacts: emit(input), metrics: [] };
    }),
  };
}

const fakeWorkspace = (): WorkspaceHandle => {
  const dir = '/tmp/uaf-fake';
  return {
    projectId: 'proj',
    dir,
    branch: 'uaf/proj',
    cleanup: vi.fn(async () => undefined),
  };
};

describe('orchestrator', () => {
  it('runs the full loop, writes REPORT.md, cleans up on success', async () => {
    const writtenFiles: Record<string, string> = {};
    // Intercept fs writes by using a scaffold that captures REPORT after orchestrator writes it.
    const recipe = makeRecipe();
    const handle = fakeWorkspace();

    const passingTestReport: TestReport = {
      passed: 3,
      failed: 0,
      durationMs: 10,
      failures: [],
    };

    // Use real fs by creating a real temp workspace dir
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    handle.dir = await mkdtemp(join(tmpdir(), 'uaf-orch-'));

    try {
      const report = await runOrchestrator({
        request: 'make a thing',
        typeHint: 'demo',
        logger: nullLogger,
        keepWorkspace: true,
        deps: {
          classify: async (req, typeHint) => ({
            type: typeHint ?? 'demo',
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
          runTests: async () => passingTestReport,
        },
      });

      expect(report.halted).toBe(false);
      expect(report.completion.done).toBe(true);
      expect(report.completion.overall).toBe(100);
      expect(report.iterations).toHaveLength(1);
      writtenFiles['REPORT.md'] = await readFile(join(handle.dir, 'REPORT.md'), 'utf8');
      expect(writtenFiles['REPORT.md']).toContain('Done: yes');

      const spec = await readFile(join(handle.dir, 'spec.md'), 'utf8');
      expect(spec).toBe('# spec');
      const design = await readFile(join(handle.dir, 'design.md'), 'utf8');
      expect(design).toBe('# design');
    } finally {
      await rm(handle.dir, { recursive: true, force: true });
    }
    // No auto-cleanup because keepWorkspace: true
    expect(handle.cleanup).not.toHaveBeenCalled();
  });

  it('F20: projectId uses <timestamp>-<6-char-hash>, never the kebab slug', async () => {
    const recipe = makeRecipe();
    const longJapanese =
      'シンプルなマークダウンエディタ。左ペインに .md ファイル一覧、中央で編集、右ペインでプレビュー。ローカルファイルの読み書きはメインプロセス経由で IPC。';
    const specialChars = '<<foo>> `bar` | baz & qux ? "quux" * plugh';
    const shortEnglish = 'hello world';

    const captured: string[] = [];
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const baseDir = await mkdtemp(join(tmpdir(), 'uaf-f20-'));

    try {
      for (const request of [shortEnglish, longJapanese, specialChars]) {
        const handle: WorkspaceHandle = {
          projectId: 'will-be-overwritten',
          dir: await mkdtemp(join(baseDir, 'ws-')),
          branch: 'uaf/test',
          cleanup: vi.fn(async () => undefined),
        };
        const report = await runOrchestrator({
          request,
          typeHint: 'demo',
          logger: nullLogger,
          keepWorkspace: true,
          deps: {
            classify: async (req, typeHint) => ({
              type: typeHint ?? 'demo',
              features: [],
              complexity: 'simple',
              slug: 'ignored-by-F20',
              rawRequest: req,
            }),
            loadRecipe: async () => recipe,
            createWorkspace: async (projectId) => {
              captured.push(projectId);
              return handle;
            },
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

        // Shape: 12-digit timestamp + "-" + 6 hex chars = 19 chars, pure ASCII.
        expect(report.projectId).toMatch(/^\d{12}-[0-9a-f]{6}$/);
        expect(report.projectId.length).toBe(19);
        // Ensure no part of the raw request leaks into the path.
        expect(report.projectId).not.toContain('シンプル');
        expect(report.projectId).not.toContain('ignored-by-F20');

        // REPORT.md still contains the original request (display preserved).
        const reportMd = await readFile(join(handle.dir, 'REPORT.md'), 'utf8');
        expect(reportMd).toContain(request);
      }

      // Different requests produce different hashes.
      expect(new Set(captured).size).toBe(3);
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  it('F20: requestHash is deterministic and collision-resistant enough', () => {
    // Same input → same output
    expect(requestHash('hello')).toBe(requestHash('hello'));
    expect(requestHash('シンプルなマークダウンエディタ')).toBe(
      requestHash('シンプルなマークダウンエディタ'),
    );
    // Different inputs → different outputs (6-hex = 16M values; 3 samples never collide)
    const hashes = new Set(
      ['a', 'b', 'c', 'hello', 'world', 'シンプルなマークダウンエディタ', 'マークダウン'].map(
        requestHash,
      ),
    );
    expect(hashes.size).toBe(7);
    // Shape
    expect(requestHash('anything')).toMatch(/^[0-9a-f]{6}$/);
  });

  it('halts via circuit breaker when tests keep failing', async () => {
    const recipe = makeRecipe();
    const handle = fakeWorkspace();
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    handle.dir = await mkdtemp(join(tmpdir(), 'uaf-orch-halt-'));

    try {
      const report = await runOrchestrator({
        request: 'make a thing',
        typeHint: 'demo',
        logger: nullLogger,
        keepWorkspace: true,
        breakerConfig: { maxIterations: 20, repeatedErrorThreshold: 2 },
        deps: {
          classify: async (req, typeHint) => ({
            type: typeHint ?? 'demo',
            features: [],
            complexity: 'simple',
            slug: 'fake',
            rawRequest: req,
          }),
          loadRecipe: async () => recipe,
          createWorkspace: async () => handle,
          makeAgents: async () =>
            fullAgentMap({
              director: makeAgent('director'),
              architect: makeAgent('architect'),
              programmer: makeAgent('programmer'),
              tester: makeAgent('tester'),
              reviewer: makeAgent('reviewer'),
              evaluator: makeAgent('evaluator'),
            }),
          scaffold: async () => undefined,
          build: async () => ({ ok: true, output: '' }),
          runTests: async () => ({
            passed: 0,
            failed: 1,
            durationMs: 10,
            failures: [{ suite: 's', name: 'n', message: 'boom' }],
          }),
        },
      });
      expect(report.halted).toBe(true);
      expect(report.haltReason).toMatch(/repeated error/);
    } finally {
      await rm(handle.dir, { recursive: true, force: true });
    }
  });
});
