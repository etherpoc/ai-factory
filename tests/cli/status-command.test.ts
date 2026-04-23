/**
 * Phase 7.8.4 — `uaf status <proj-id>` smoke tests.
 *
 * Renders the state.json into a human-readable summary. The interesting
 * branches are:
 *   - missing state.json → graceful "no state" message
 *   - legacy state (no phase / no roadmap) → legacy badge
 *   - full Phase 7.8 state → roadmap progress + per-task badges
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  writeWorkspaceState,
  type WorkspaceState,
} from '../../core/state.js';

let base: string;
let prevCwd: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'uaf-status-'));
  await mkdir(join(base, 'workspace'));
  prevCwd = process.cwd();
  process.chdir(base);
});
afterEach(async () => {
  process.chdir(prevCwd);
  await rm(base, { recursive: true, force: true });
});

async function captureStdout(fn: () => Promise<void>): Promise<string> {
  const original = process.stdout.write.bind(process.stdout);
  let captured = '';
  process.stdout.write = ((chunk: unknown) => {
    captured += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  try {
    await fn();
  } finally {
    process.stdout.write = original;
  }
  return captured;
}

describe('cli/commands/status', () => {
  it('renders a Phase 7.8 workspace with phase + roadmap + per-task badges', async () => {
    const projDir = join(base, 'workspace', 'p1');
    await mkdir(projDir);
    const state: WorkspaceState = {
      projectId: 'p1',
      recipeType: '2d-game',
      originalRequest: '避けゲーを作って',
      createdAt: '2026-04-23T00:00:00.000Z',
      lastRunAt: '2026-04-23T00:10:00.000Z',
      status: 'in-progress',
      iterations: [],
      phase: 'build',
      resumable: true,
      spec: {
        path: 'spec.md',
        createdAt: '2026-04-23T00:01:00.000Z',
        dialogTurns: 5,
        userApproved: true,
      },
      roadmap: {
        path: 'roadmap.md',
        createdAt: '2026-04-23T00:02:00.000Z',
        totalTasks: 3,
        completedTasks: 1,
        currentTaskId: 'task-002',
        tasks: [
          { id: 'task-001', title: 'scaffold', status: 'completed' },
          { id: 'task-002', title: 'gameplay', status: 'in-progress' },
          { id: 'task-003', title: 'verify', status: 'pending' },
        ],
        estimatedCostUsd: 0.5,
      },
    };
    await writeWorkspaceState(projDir, state);

    const { runStatus } = await import('../../cli/commands/status.js');
    const out = await captureStdout(() => runStatus({ projectId: 'p1' }));

    expect(out).toContain('p1');
    expect(out).toContain('避けゲーを作って');
    expect(out).toContain('build');
    expect(out).toContain('1/3');
    expect(out).toContain('task-001');
    expect(out).toContain('task-002');
    expect(out).toContain('task-003');
    expect(out).toContain('dialogTurns: 5');
  });

  it('flags legacy workspaces (no phase, no roadmap)', async () => {
    const projDir = join(base, 'workspace', 'old');
    await mkdir(projDir);
    const state: WorkspaceState = {
      projectId: 'old',
      recipeType: '2d-game',
      originalRequest: 'legacy thing',
      createdAt: '2026-04-22T00:00:00.000Z',
      lastRunAt: '2026-04-22T00:10:00.000Z',
      status: 'completed',
      iterations: [
        { ts: '2026-04-22T00:00:00.000Z', mode: 'create', request: 'legacy thing', done: true, overall: 90 },
      ],
    };
    await writeWorkspaceState(projDir, state);

    const { runStatus } = await import('../../cli/commands/status.js');
    const out = await captureStdout(() => runStatus({ projectId: 'old' }));
    expect(out).toContain('legacy');
  });

  it('falls back gracefully when state.json is missing', async () => {
    const projDir = join(base, 'workspace', 'noState');
    await mkdir(projDir);

    const { runStatus } = await import('../../cli/commands/status.js');
    // Capture stderr too because the no-state path writes the warning there.
    const origErr = process.stderr.write.bind(process.stderr);
    let errBuf = '';
    process.stderr.write = ((c: unknown) => {
      errBuf += String(c);
      return true;
    }) as typeof process.stderr.write;
    try {
      const out = await captureStdout(() => runStatus({ projectId: 'noState' }));
      expect(out).toContain('noState');
      expect(errBuf).toMatch(/state\.json/i);
    } finally {
      process.stderr.write = origErr;
    }
  });

  it('emits JSON when --json is set', async () => {
    const projDir = join(base, 'workspace', 'jp');
    await mkdir(projDir);
    await writeWorkspaceState(projDir, {
      projectId: 'jp',
      recipeType: 'web-app',
      originalRequest: 'json test',
      createdAt: '2026-04-23T00:00:00.000Z',
      lastRunAt: '2026-04-23T00:00:00.000Z',
      status: 'completed',
      iterations: [],
    });

    const { runStatus } = await import('../../cli/commands/status.js');
    const out = await captureStdout(() => runStatus({ projectId: 'jp' }, { json: true }));
    const parsed = JSON.parse(out);
    expect(parsed.project.projectId).toBe('jp');
    expect(parsed.project.state.recipeType).toBe('web-app');
    expect(parsed.project).toHaveProperty('cost');
  });
});
