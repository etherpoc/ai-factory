/**
 * Phase 7.8.1 — checkpoint writer.
 *
 * The orchestrator uses writeTaskCheckpoint at every roadmap-task boundary
 * to keep state.json in sync. These tests cover the state-machine bits:
 * status transitions, phase transitions, currentTaskId tracking, and
 * resumable flag flipping.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  isResumableState,
  writeInterruptCheckpoint,
  writeTaskCheckpoint,
} from '../../core/checkpoint.js';
import {
  readWorkspaceState,
  writeWorkspaceState,
  type WorkspaceState,
} from '../../core/state.js';

let proj: string;
beforeEach(async () => {
  const base = await mkdtemp(join(tmpdir(), 'uaf-cp-'));
  proj = join(base, 'p1');
  await mkdir(proj);
});
afterEach(async () => {
  await rm(proj, { recursive: true, force: true }).catch(() => undefined);
});

function withRoadmap(taskCount: number): WorkspaceState {
  return {
    projectId: 'p1',
    recipeType: '2d-game',
    originalRequest: 'r',
    createdAt: '2026-04-22T00:00:00.000Z',
    lastRunAt: '2026-04-22T00:00:00.000Z',
    status: 'in-progress',
    iterations: [],
    phase: 'build',
    resumable: true,
    roadmap: {
      path: 'roadmap.md',
      createdAt: '2026-04-22T00:00:00.000Z',
      totalTasks: taskCount,
      completedTasks: 0,
      tasks: Array.from({ length: taskCount }, (_, i) => ({
        id: `t${i + 1}`,
        title: `Task ${i + 1}`,
        status: 'pending' as const,
      })),
    },
  };
}

describe('writeTaskCheckpoint — task status transitions', () => {
  it('marks a task in-progress, sets startedAt, sets currentTaskId', async () => {
    await writeWorkspaceState(proj, withRoadmap(3));
    const { state, task } = await writeTaskCheckpoint(proj, {
      taskId: 't1',
      status: 'in-progress',
    });
    expect(task.status).toBe('in-progress');
    expect(task.startedAt).toBeTypeOf('string');
    expect(state.roadmap?.currentTaskId).toBe('t1');
    expect(state.lastCheckpointAt).toBeTypeOf('string');
    expect(state.resumable).toBe(true);
  });

  it('marks a task completed, sets completedAt, clears currentTaskId, accumulates cost', async () => {
    await writeWorkspaceState(proj, withRoadmap(2));
    await writeTaskCheckpoint(proj, { taskId: 't1', status: 'in-progress', costUsd: 0.05 });
    const { state, task, allDone } = await writeTaskCheckpoint(proj, {
      taskId: 't1',
      status: 'completed',
      costUsd: 0.10,
      filesAdded: ['src/main.ts'],
    });
    expect(task.status).toBe('completed');
    expect(task.completedAt).toBeTypeOf('string');
    expect(task.costUsd).toBeCloseTo(0.15, 6);
    expect(task.filesAdded).toEqual(['src/main.ts']);
    expect(state.roadmap?.currentTaskId).toBeUndefined();
    expect(state.roadmap?.completedTasks).toBe(1);
    expect(allDone).toBe(false);
    expect(state.phase).toBe('build');
  });

  it('completing the last task transitions phase to complete and resumable to false', async () => {
    await writeWorkspaceState(proj, withRoadmap(1));
    const { state, allDone } = await writeTaskCheckpoint(proj, {
      taskId: 't1',
      status: 'completed',
    });
    expect(allDone).toBe(true);
    expect(state.phase).toBe('complete');
    expect(state.resumable).toBe(false);
  });

  it('a failed task sets phase to failed', async () => {
    await writeWorkspaceState(proj, withRoadmap(2));
    const { state } = await writeTaskCheckpoint(proj, { taskId: 't1', status: 'failed' });
    expect(state.phase).toBe('failed');
    expect(state.resumable).toBe(false);
  });

  it('skipped tasks count toward "all done"', async () => {
    await writeWorkspaceState(proj, withRoadmap(2));
    await writeTaskCheckpoint(proj, { taskId: 't1', status: 'completed' });
    const { allDone, state } = await writeTaskCheckpoint(proj, { taskId: 't2', status: 'skipped' });
    expect(allDone).toBe(true);
    expect(state.phase).toBe('complete');
  });

  it('throws when state.json or roadmap is missing', async () => {
    await expect(
      writeTaskCheckpoint(proj, { taskId: 't1', status: 'completed' }),
    ).rejects.toThrow(/no state\.json/);

    const noRoadmap: WorkspaceState = {
      projectId: 'p1',
      recipeType: '2d-game',
      originalRequest: 'r',
      createdAt: '2026-04-22T00:00:00.000Z',
      lastRunAt: '2026-04-22T00:00:00.000Z',
      status: 'in-progress',
      iterations: [],
    };
    await writeWorkspaceState(proj, noRoadmap);
    await expect(
      writeTaskCheckpoint(proj, { taskId: 't1', status: 'completed' }),
    ).rejects.toThrow(/no roadmap/);
  });

  it('throws on unknown taskId', async () => {
    await writeWorkspaceState(proj, withRoadmap(1));
    await expect(
      writeTaskCheckpoint(proj, { taskId: 'nope', status: 'completed' }),
    ).rejects.toThrow(/unknown taskId/);
  });
});

describe('writeInterruptCheckpoint', () => {
  it('marks state interrupted and resumable=true, stamps reason on current task', async () => {
    await writeWorkspaceState(proj, withRoadmap(2));
    await writeTaskCheckpoint(proj, { taskId: 't1', status: 'in-progress' });
    const next = await writeInterruptCheckpoint(proj, 'SIGINT (Ctrl+C)');
    expect(next?.phase).toBe('interrupted');
    expect(next?.status).toBe('interrupted');
    expect(next?.resumable).toBe(true);
    const reread = await readWorkspaceState(proj);
    expect(reread?.roadmap?.tasks[0]?.metadata?.interruptReason).toBe('SIGINT (Ctrl+C)');
  });

  it('returns null and is a no-op when state.json is missing', async () => {
    const out = await writeInterruptCheckpoint(proj, 'whatever');
    expect(out).toBeNull();
  });
});

describe('isResumableState', () => {
  it('false for null / complete / explicit resumable=false', () => {
    expect(isResumableState(null)).toBe(false);
    const base = withRoadmap(1);
    expect(isResumableState({ ...base, phase: 'complete' })).toBe(false);
    expect(isResumableState({ ...base, resumable: false })).toBe(false);
  });

  it('true for in-progress builds with a roadmap', () => {
    expect(isResumableState({ ...withRoadmap(1), phase: 'build' })).toBe(true);
    expect(isResumableState({ ...withRoadmap(1), phase: 'interrupted' })).toBe(true);
    expect(isResumableState({ ...withRoadmap(1), phase: 'failed' })).toBe(true);
  });

  it('true for spec/roadmap phases even without a roadmap yet', () => {
    const base = {
      projectId: 'p1',
      recipeType: '2d-game',
      originalRequest: 'r',
      createdAt: '2026-04-22T00:00:00.000Z',
      lastRunAt: '2026-04-22T00:00:00.000Z',
      status: 'in-progress' as const,
      iterations: [],
      resumable: true,
    };
    expect(isResumableState({ ...base, phase: 'spec' })).toBe(true);
    expect(isResumableState({ ...base, phase: 'roadmap' })).toBe(true);
  });
});
