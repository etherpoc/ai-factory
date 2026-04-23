/**
 * Phase 7.8.1 — state.json schema (core/state.ts).
 *
 * Two things to lock in:
 *   1. Backward compat: state.json files written before Phase 7.8 (no phase,
 *      no roadmap, no spec) must still validate and load.
 *   2. Forward compat: the new optional Phase-7.8 fields (phase, spec,
 *      roadmap, resumable, lastCheckpointAt) round-trip through write→read.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  WorkspaceStateSchema,
  isLegacyState,
  readWorkspaceState,
  upsertWorkspaceState,
  writeWorkspaceState,
  type WorkspaceState,
} from '../../core/state.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'uaf-state-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const baseLegacy: WorkspaceState = {
  projectId: 'p1',
  recipeType: '2d-game',
  originalRequest: 'old request',
  createdAt: '2026-04-22T00:00:00.000Z',
  lastRunAt: '2026-04-22T00:10:00.000Z',
  status: 'completed',
  iterations: [
    {
      ts: '2026-04-22T00:00:00.000Z',
      mode: 'create',
      request: 'old request',
      done: true,
      overall: 95,
    },
  ],
};

describe('core/state — backward compatibility', () => {
  it('loads a Phase-7.5/11.a-shaped state.json (no phase, no roadmap, no spec)', async () => {
    const proj = join(dir, 'p1');
    await mkdir(proj);
    await writeFile(join(proj, 'state.json'), JSON.stringify(baseLegacy), 'utf8');
    const loaded = await readWorkspaceState(proj);
    expect(loaded).toEqual(baseLegacy);
    expect(isLegacyState(loaded)).toBe(true);
  });

  it('isLegacyState returns false once a roadmap is set', async () => {
    const proj = join(dir, 'p2');
    await mkdir(proj);
    const withRoadmap: WorkspaceState = {
      ...baseLegacy,
      phase: 'build',
      roadmap: {
        path: 'roadmap.md',
        createdAt: '2026-04-22T00:05:00.000Z',
        totalTasks: 1,
        completedTasks: 0,
        tasks: [{ id: 't1', title: 'first', status: 'pending' }],
      },
    };
    await writeWorkspaceState(proj, withRoadmap);
    expect(isLegacyState(await readWorkspaceState(proj))).toBe(false);
  });

  it('rejects unknown phase enum values (schema is the contract)', () => {
    const bad = { ...baseLegacy, phase: 'wibble' };
    const r = WorkspaceStateSchema.safeParse(bad);
    expect(r.success).toBe(false);
  });
});

describe('core/state — Phase 7.8 round-trip', () => {
  it('preserves spec / roadmap / resumable / lastCheckpointAt', async () => {
    const proj = join(dir, 'p3');
    await mkdir(proj);
    const full: WorkspaceState = {
      projectId: 'p3',
      recipeType: '2d-game',
      originalRequest: 'avoid the bullets',
      createdAt: '2026-04-22T00:00:00.000Z',
      lastRunAt: '2026-04-22T00:10:00.000Z',
      status: 'in-progress',
      iterations: [],
      phase: 'build',
      spec: {
        path: 'spec.md',
        createdAt: '2026-04-22T00:01:00.000Z',
        dialogTurns: 5,
        userApproved: true,
      },
      roadmap: {
        path: 'roadmap.md',
        createdAt: '2026-04-22T00:02:00.000Z',
        totalTasks: 2,
        completedTasks: 1,
        currentTaskId: 't2',
        tasks: [
          {
            id: 't1',
            title: 'scaffold',
            status: 'completed',
            startedAt: '2026-04-22T00:03:00.000Z',
            completedAt: '2026-04-22T00:04:00.000Z',
            costUsd: 0.05,
            filesAdded: ['package.json'],
            filesModified: [],
          },
          {
            id: 't2',
            title: 'gameplay',
            status: 'in-progress',
            startedAt: '2026-04-22T00:05:00.000Z',
          },
        ],
        estimatedCostUsd: 1.5,
        estimatedDurationMin: 12,
      },
      resumable: true,
      lastCheckpointAt: '2026-04-22T00:09:00.000Z',
    };
    await writeWorkspaceState(proj, full);
    const got = await readWorkspaceState(proj);
    expect(got).toEqual(full);
  });

  it('upsertWorkspaceState supports partial Phase-7.8 updates without an iteration entry', async () => {
    const proj = join(dir, 'p4');
    await mkdir(proj);
    // First call: create state with a spec but no roadmap, no iteration.
    const s1 = await upsertWorkspaceState(proj, {
      projectId: 'p4',
      recipeType: '2d-game',
      originalRequest: 'foo',
      status: 'in-progress',
      phase: 'spec',
      spec: {
        path: 'spec.md',
        createdAt: '2026-04-22T00:01:00.000Z',
        dialogTurns: 3,
        userApproved: true,
      },
      resumable: true,
    });
    expect(s1.iterations).toEqual([]);
    expect(s1.spec?.dialogTurns).toBe(3);
    expect(s1.phase).toBe('spec');

    // Second call: transition to roadmap phase, still no iteration entry.
    const s2 = await upsertWorkspaceState(proj, {
      projectId: 'p4',
      recipeType: '2d-game',
      originalRequest: 'foo',
      status: 'in-progress',
      phase: 'roadmap',
      roadmap: {
        path: 'roadmap.md',
        createdAt: '2026-04-22T00:02:00.000Z',
        totalTasks: 1,
        completedTasks: 0,
        tasks: [{ id: 't1', title: 'a', status: 'pending' }],
      },
    });
    expect(s2.iterations).toEqual([]); // still empty
    expect(s2.spec?.dialogTurns).toBe(3); // spec preserved
    expect(s2.phase).toBe('roadmap');
    expect(s2.roadmap?.totalTasks).toBe(1);
  });
});
