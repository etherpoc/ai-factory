/**
 * Phase 7.8.2 — `runSpecWizard` integration tests with stub strategy / prompter.
 * Phase 7.8.9 — interactive revise flow tests.
 *
 * Branches covered:
 *   1. --spec-file: no LLM call, no prompts, file is copied verbatim.
 *   2. Dialogue + approval: stub strategy writes spec.md via tools, user
 *      approves with `y`.
 *   3. Failure modes: interviewer doesn't write spec.md → loud error.
 *   4. Revise mode (Phase 7.8.9): e → "interactive" → instruction → stub
 *      strategy rewrites spec.md → preview → y approves. Also covers the
 *      MAX_REVISIONS circuit breaker and the editor-only fallback.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile as fsWriteFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MetricsRecorder } from '../../core/metrics.js';
import { nullLogger } from '../../core/logger.js';
import type {
  AgentInput,
  AgentRole,
  Recipe,
  Tool,
  ToolContext,
} from '../../core/types.js';
import type { AgentStrategy } from '../../core/agent-factory.js';
import type { AskUserPrompter } from '../../core/tools/ask-user.js';
import type { Prompter } from '../../cli/interactive/prompts.js';
import { MAX_REVISIONS, runSpecWizard } from '../../cli/interactive/spec-wizard.js';
import { REVISE_MODE_MARKER } from '../../agents/interviewer/index.js';
import { UafError } from '../../cli/ui/errors.js';

let repoRoot: string;
let workspace: string;

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

beforeEach(async () => {
  // Set up a fake repoRoot with the interviewer prompt.md (createAgent
  // reads from `<repoRoot>/agents/<role>/prompt.md`).
  repoRoot = await mkdtemp(join(tmpdir(), 'uaf-sw-repo-'));
  await mkdir(join(repoRoot, 'agents', 'interviewer'), { recursive: true });
  await fsWriteFile(
    join(repoRoot, 'agents', 'interviewer', 'prompt.md'),
    'INTERVIEWER_PROMPT',
    'utf8',
  );
  workspace = await mkdtemp(join(tmpdir(), 'uaf-sw-ws-'));
});
afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true });
  await rm(workspace, { recursive: true, force: true });
});

describe('spec-wizard — --spec-file branch', () => {
  it('copies the file verbatim and reports userApproved=true with no dialogue', async () => {
    const external = join(repoRoot, 'external-spec.md');
    await fsWriteFile(external, '# external spec\n\nstuff', 'utf8');

    const metrics = new MetricsRecorder({
      projectId: 'p1',
      dir: workspace,
      logger: nullLogger,
    });
    const out = await runSpecWizard({
      request: 'foo',
      workspaceDir: workspace,
      projectId: 'p1',
      recipe: recipe(),
      strategy: { run: vi.fn() } as unknown as AgentStrategy,
      metrics,
      repoRoot,
      specFile: external,
    });

    expect(out.dialogTurns).toBe(0);
    expect(out.userApproved).toBe(true);
    expect(out.specPath).toBe(join(workspace, 'spec.md'));
    expect(await readFile(out.specPath, 'utf8')).toBe('# external spec\n\nstuff');
  });
});

describe('spec-wizard — dialogue branch', () => {
  /** A fake strategy that uses the supplied tools to ask 2 questions and write spec.md. */
  function fakeInterviewerStrategy(): AgentStrategy {
    return {
      async run(_role, _input, _systemPrompt, tools, _ctx, extras) {
        const ws = extras?.workspaceDir ?? '/tmp';
        const askUser = tools.find((t) => t.name === 'ask_user') as Tool | undefined;
        const writeFileT = tools.find((t) => t.name === 'write_file') as Tool | undefined;
        if (!askUser || !writeFileT) {
          throw new Error('test setup: missing tool');
        }
        const toolCtx: ToolContext = {
          workspaceDir: ws,
          projectId: _input.projectId,
          logger: nullLogger,
        };
        await askUser.run({ question: 'q1', options: ['a', 'b'] }, toolCtx);
        await askUser.run({ question: 'q2' }, toolCtx);
        await writeFileT.run(
          { path: 'spec.md', content: '# fake spec\n\ndone' },
          toolCtx,
        );
        return { artifacts: {}, notes: 'asked 2 questions and wrote spec.md' };
      },
    };
  }

  function fakeAskUserPrompter(): AskUserPrompter {
    return {
      select: vi.fn().mockResolvedValue({ answer: 'a', selectedIndex: 0 }),
      input: vi.fn().mockResolvedValue('typed answer'),
    };
  }

  function autoApprover(): Prompter {
    return {
      input: vi.fn(),
      select: vi.fn().mockResolvedValue('y'),
      confirm: vi.fn(),
      number: vi.fn(),
    };
  }

  it('runs the interviewer, counts turns, and gates on approval', async () => {
    const metrics = new MetricsRecorder({
      projectId: 'p2',
      dir: workspace,
      logger: nullLogger,
    });
    const out = await runSpecWizard({
      request: '避けゲーを作って',
      workspaceDir: workspace,
      projectId: 'p2',
      recipe: recipe(),
      strategy: fakeInterviewerStrategy(),
      metrics,
      repoRoot,
      askUserPrompter: fakeAskUserPrompter(),
      approvalPrompter: autoApprover(),
    });
    expect(out.dialogTurns).toBe(2);
    expect(out.userApproved).toBe(true);
    expect(await readFile(out.specPath, 'utf8')).toContain('# fake spec');
  });

  it('rejecting at the approval prompt throws USER_ABORT', async () => {
    const rejector: Prompter = {
      input: vi.fn(),
      select: vi.fn().mockResolvedValue('n'),
      confirm: vi.fn(),
      number: vi.fn(),
    };
    const metrics = new MetricsRecorder({
      projectId: 'p3',
      dir: workspace,
      logger: nullLogger,
    });
    const promise = runSpecWizard({
      request: '何か',
      workspaceDir: workspace,
      projectId: 'p3',
      recipe: recipe(),
      strategy: fakeInterviewerStrategy(),
      metrics,
      repoRoot,
      askUserPrompter: fakeAskUserPrompter(),
      approvalPrompter: rejector,
    });
    await expect(promise).rejects.toBeInstanceOf(UafError);
    await expect(promise).rejects.toMatchObject({ code: 'USER_ABORT' });
  });

  it('autoApprove skips the y/N prompt entirely', async () => {
    const refusing: Prompter = {
      input: vi.fn(),
      select: vi.fn(() => Promise.reject(new Error('should not be called'))),
      confirm: vi.fn(),
      number: vi.fn(),
    };
    const metrics = new MetricsRecorder({
      projectId: 'p4',
      dir: workspace,
      logger: nullLogger,
    });
    const out = await runSpecWizard({
      request: 'x',
      workspaceDir: workspace,
      projectId: 'p4',
      recipe: recipe(),
      strategy: fakeInterviewerStrategy(),
      metrics,
      repoRoot,
      askUserPrompter: fakeAskUserPrompter(),
      approvalPrompter: refusing,
      autoApprove: true,
    });
    expect(out.userApproved).toBe(true);
  });
});

describe('spec-wizard — interactive revise (Phase 7.8.9)', () => {
  /**
   * Strategy that acts differently depending on whether the user message
   * starts with the REVISE marker:
   *   - create: write a "v1" spec
   *   - revise: verify artifacts.spec == v1 AND request contains the
   *     revision instruction, then write a "v2" spec embedding the
   *     instruction (so tests can assert the change propagated)
   */
  function reviseAwareStrategy(seen: {
    reviseCalls: number;
    lastRevisionRequest?: string;
    lastArtifactsSpec?: string;
  }): AgentStrategy {
    return {
      async run(_role, input, _systemPrompt, tools, _ctx, extras) {
        const ws = extras?.workspaceDir ?? '/tmp';
        const writeFileT = tools.find((t) => t.name === 'write_file') as
          | Tool
          | undefined;
        if (!writeFileT) throw new Error('test setup: missing write_file');
        const toolCtx: ToolContext = {
          workspaceDir: ws,
          projectId: input.projectId,
          logger: nullLogger,
        };
        const isRevise = input.request.startsWith(REVISE_MODE_MARKER);
        if (isRevise) {
          seen.reviseCalls += 1;
          seen.lastRevisionRequest = input.request;
          seen.lastArtifactsSpec = input.artifacts.spec;
          // Produce a v2 that embeds the raw request so we can assert.
          await writeFileT.run(
            {
              path: 'spec.md',
              content:
                '# spec v2\n\n' +
                '## 変更要望\n' +
                input.request +
                '\n\n## 元仕様\n' +
                (input.artifacts.spec ?? ''),
            },
            toolCtx,
          );
          return { artifacts: {}, notes: 'revise done' };
        }
        await writeFileT.run(
          { path: 'spec.md', content: '# spec v1\n\ninitial content' },
          toolCtx,
        );
        return { artifacts: {}, notes: 'create done' };
      },
    };
  }

  /**
   * Scripted prompter for the approval flow. Each call to select / input
   * consumes one entry from the given queues in order. Throws if a queue
   * is exhausted (indicates test expectation mismatch).
   */
  function scriptedPrompter(opts: {
    selects: string[];
    inputs?: string[];
  }): Prompter {
    const selects = [...opts.selects];
    const inputs = [...(opts.inputs ?? [])];
    return {
      input: vi.fn(async () => {
        if (inputs.length === 0) throw new Error('unexpected prompter.input call');
        return inputs.shift()!;
      }),
      select: vi.fn(async () => {
        if (selects.length === 0) throw new Error('unexpected prompter.select call');
        return selects.shift() as unknown as string;
      }) as unknown as Prompter['select'],
      confirm: vi.fn(),
      number: vi.fn(),
    };
  }

  function nullAskUserPrompter(): AskUserPrompter {
    return {
      select: vi.fn().mockResolvedValue({ answer: 'x', selectedIndex: 0 }),
      input: vi.fn().mockResolvedValue(''),
    };
  }

  it('e → interactive → instruction rewrites spec.md and y approves', async () => {
    const seen: {
      reviseCalls: number;
      lastRevisionRequest?: string;
      lastArtifactsSpec?: string;
    } = { reviseCalls: 0 };
    const metrics = new MetricsRecorder({
      projectId: 'p-rev-1',
      dir: workspace,
      logger: nullLogger,
    });
    const approver = scriptedPrompter({
      // y/N/e  →  interactive/editor  →  y/N/e
      selects: ['e', 'interactive', 'y'],
      inputs: ['難易度を10秒ごとに20%アップに、敵を3種類'],
    });
    const out = await runSpecWizard({
      request: 'avoid-game',
      workspaceDir: workspace,
      projectId: 'p-rev-1',
      recipe: recipe(),
      strategy: reviseAwareStrategy(seen),
      metrics,
      repoRoot,
      askUserPrompter: nullAskUserPrompter(),
      approvalPrompter: approver,
    });
    expect(seen.reviseCalls).toBe(1);
    // Interviewer received REVISE marker and the v1 spec.
    expect(seen.lastRevisionRequest).toContain(REVISE_MODE_MARKER);
    expect(seen.lastRevisionRequest).toContain('難易度を10秒ごとに20%アップ');
    expect(seen.lastArtifactsSpec).toContain('# spec v1');
    expect(out.revisionCount).toBe(1);
    expect(out.userApproved).toBe(true);
    // The updated spec.md is the v2 produced by the revise call.
    const final = await readFile(out.specPath, 'utf8');
    expect(final).toContain('# spec v2');
    expect(final).toContain('難易度を10秒ごとに20%アップ');
  });

  it('empty revise instruction is rejected and loops back without counting', async () => {
    const seen = { reviseCalls: 0 };
    const metrics = new MetricsRecorder({
      projectId: 'p-rev-2',
      dir: workspace,
      logger: nullLogger,
    });
    const approver = scriptedPrompter({
      //   e → interactive → (empty instruction, loops) → y
      selects: ['e', 'interactive', 'y'],
      inputs: ['   '],
    });
    const out = await runSpecWizard({
      request: 'x',
      workspaceDir: workspace,
      projectId: 'p-rev-2',
      recipe: recipe(),
      strategy: reviseAwareStrategy(seen),
      metrics,
      repoRoot,
      askUserPrompter: nullAskUserPrompter(),
      approvalPrompter: approver,
    });
    // Interviewer was not invoked for the empty instruction.
    expect(seen.reviseCalls).toBe(0);
    expect(out.revisionCount).toBe(0);
    expect(out.userApproved).toBe(true);
  });

  it('hits MAX_REVISIONS and then falls back to editor-only on next e', async () => {
    const seen = { reviseCalls: 0 };
    const metrics = new MetricsRecorder({
      projectId: 'p-rev-3',
      dir: workspace,
      logger: nullLogger,
    });
    // Run MAX_REVISIONS interactive revises, then one more e that should
    // skip the interactive/editor submenu (editor-only fallback). We
    // don't actually launch an editor in the test: inject an editor that
    // writes to stdout and exits 0 — but simpler, use a no-op editor
    // command like `node -e ""` which on all platforms is available in
    // CI. To keep the test hermetic we override opts.editor.
    // Each revise cycle: e → interactive → instruction
    const selects: string[] = [];
    const inputs: string[] = [];
    for (let i = 0; i < MAX_REVISIONS; i++) {
      selects.push('e', 'interactive');
      inputs.push(`fix ${i}`);
    }
    // After MAX revises, one more `e`. Because the limit is reached, the
    // wizard should NOT present the interactive/editor submenu: it just
    // opens the editor directly. So the next entries are:
    //   e (the post-limit action) → y (final approval)
    selects.push('e', 'y');
    // Use a cross-platform no-op "editor" that exits 0 immediately.
    // `node --version` writes to stdout and exits 0; it ignores the path arg.
    const noopEditor = 'node';
    const approver = scriptedPrompter({ selects, inputs });
    const out = await runSpecWizard({
      request: 'x',
      workspaceDir: workspace,
      projectId: 'p-rev-3',
      recipe: recipe(),
      strategy: reviseAwareStrategy(seen),
      metrics,
      repoRoot,
      askUserPrompter: nullAskUserPrompter(),
      approvalPrompter: approver,
      editor: noopEditor,
    });
    expect(seen.reviseCalls).toBe(MAX_REVISIONS);
    expect(out.revisionCount).toBe(MAX_REVISIONS);
    expect(out.userApproved).toBe(true);
  });
});

describe('spec-wizard — failure modes', () => {
  it('throws RUNTIME_FAILURE when the interviewer never writes spec.md', async () => {
    const noSpecStrategy: AgentStrategy = {
      async run() {
        return { artifacts: {}, notes: 'forgot to write spec.md' };
      },
    };
    const metrics = new MetricsRecorder({
      projectId: 'p5',
      dir: workspace,
      logger: nullLogger,
    });
    const promise = runSpecWizard({
      request: 'x',
      workspaceDir: workspace,
      projectId: 'p5',
      recipe: recipe(),
      strategy: noSpecStrategy,
      metrics,
      repoRoot,
      askUserPrompter: {
        select: vi.fn(),
        input: vi.fn(),
      },
    });
    await expect(promise).rejects.toBeInstanceOf(UafError);
    await expect(promise).rejects.toMatchObject({ code: 'RUNTIME_FAILURE' });
  });
});

// Silence the wizard's stderr writes during tests.
const originalWrite = process.stderr.write.bind(process.stderr);
beforeEach(() => {
  process.stderr.write = (() => true) as typeof process.stderr.write;
});
afterEach(() => {
  process.stderr.write = originalWrite;
});

// Suppress the unused-role hint
void undefined as unknown as AgentRole;
void undefined as unknown as AgentInput;
