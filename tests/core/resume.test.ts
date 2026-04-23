/**
 * Phase 7.8.5 — `planResume()` decision table.
 *
 * Pure logic, no LLM, no filesystem. Drives every branch with synthetic
 * states + file-survey objects.
 */
import { describe, expect, it } from 'vitest';
import { planResume } from '../../core/resume.js';
import type { WorkspaceState } from '../../core/state.js';

const allFiles = { specMd: true, roadmapMd: true, designMd: true, packageJson: true };
const noFiles = { specMd: false, roadmapMd: false, designMd: false, packageJson: false };

function legacy(): WorkspaceState {
  return {
    projectId: 'p',
    recipeType: '2d-game',
    originalRequest: 'old',
    createdAt: '2026-04-01T00:00:00.000Z',
    lastRunAt: '2026-04-01T00:00:00.000Z',
    status: 'completed',
    iterations: [],
  };
}

function withRoadmap(phase: WorkspaceState['phase']): WorkspaceState {
  return {
    projectId: 'p',
    recipeType: '2d-game',
    originalRequest: 'r',
    createdAt: '2026-04-23T00:00:00.000Z',
    lastRunAt: '2026-04-23T00:00:00.000Z',
    status: 'in-progress',
    iterations: [],
    phase,
    resumable: true,
    spec: {
      path: 'spec.md',
      createdAt: '2026-04-23T00:00:00.000Z',
      dialogTurns: 3,
      userApproved: true,
    },
    roadmap: {
      path: 'roadmap.md',
      createdAt: '2026-04-23T00:00:00.000Z',
      totalTasks: 3,
      completedTasks: 1,
      currentTaskId: 'task-002',
      tasks: [
        { id: 'task-001', title: 'a', status: 'completed' },
        { id: 'task-002', title: 'b', status: 'in-progress' },
        { id: 'task-003', title: 'c', status: 'pending' },
      ],
    },
  };
}

describe('planResume — guards', () => {
  it('null state → not-resumable', () => {
    const r = planResume({ state: null, files: noFiles });
    expect(r.action.kind).toBe('not-resumable');
  });

  it('legacy workspace → not-resumable', () => {
    const r = planResume({ state: legacy(), files: allFiles });
    expect(r.action.kind).toBe('not-resumable');
    if (r.action.kind === 'not-resumable') {
      expect(r.action.reason).toMatch(/legacy/);
    }
  });

  it('phase=complete → already-complete', () => {
    const r = planResume({ state: { ...withRoadmap('complete'), resumable: false }, files: allFiles });
    expect(r.action.kind).toBe('already-complete');
  });

  it('resumable=false → already-complete', () => {
    const r = planResume({
      state: { ...withRoadmap('build'), resumable: false },
      files: allFiles,
    });
    expect(r.action.kind).toBe('already-complete');
  });
});

describe('planResume — phase dispatch', () => {
  it('phase=spec → rerun-spec', () => {
    const r = planResume({ state: withRoadmap('spec'), files: noFiles });
    expect(r.action.kind).toBe('rerun-spec');
  });

  it('phase=spec but spec.md exists → rerun-spec with warning', () => {
    const r = planResume({ state: withRoadmap('spec'), files: allFiles });
    expect(r.action.kind).toBe('rerun-spec');
    expect(r.warnings.some((w) => /overwrite/i.test(w))).toBe(true);
  });

  it('phase=roadmap with spec.md → rerun-roadmap', () => {
    const r = planResume({ state: withRoadmap('roadmap'), files: { ...noFiles, specMd: true } });
    expect(r.action.kind).toBe('rerun-roadmap');
  });

  it('phase=roadmap without spec.md → falls back to rerun-spec', () => {
    const r = planResume({ state: withRoadmap('roadmap'), files: noFiles });
    expect(r.action.kind).toBe('rerun-spec');
    expect(r.warnings.some((w) => /missing/i.test(w))).toBe(true);
  });

  it('phase=build with all files → continue-build with next task', () => {
    const r = planResume({ state: withRoadmap('build'), files: allFiles });
    expect(r.action.kind).toBe('continue-build');
    if (r.action.kind === 'continue-build') {
      expect(r.action.nextTaskId).toBe('task-002');
    }
  });

  it('phase=interrupted with all files → continue-build', () => {
    const r = planResume({ state: withRoadmap('interrupted'), files: allFiles });
    expect(r.action.kind).toBe('continue-build');
  });

  it('phase=failed with all files → continue-build (resume retries)', () => {
    const r = planResume({ state: withRoadmap('failed'), files: allFiles });
    expect(r.action.kind).toBe('continue-build');
  });

  it('phase=build but spec.md missing → falls back to rerun-spec', () => {
    const r = planResume({
      state: withRoadmap('build'),
      files: { ...allFiles, specMd: false },
    });
    expect(r.action.kind).toBe('rerun-spec');
  });

  it('phase=build but roadmap.md missing → falls back to rerun-roadmap', () => {
    const r = planResume({
      state: withRoadmap('build'),
      files: { ...allFiles, roadmapMd: false },
    });
    expect(r.action.kind).toBe('rerun-roadmap');
  });

  it('continue-build picks the FIRST non-completed task (in-progress preferred over pending)', () => {
    const s = withRoadmap('build');
    s.roadmap!.tasks = [
      { id: 'task-001', title: 'a', status: 'completed' },
      { id: 'task-002', title: 'b', status: 'completed' },
      { id: 'task-003', title: 'c', status: 'in-progress' },
      { id: 'task-004', title: 'd', status: 'pending' },
    ];
    const r = planResume({ state: s, files: allFiles });
    if (r.action.kind === 'continue-build') {
      expect(r.action.nextTaskId).toBe('task-003');
    } else {
      throw new Error('expected continue-build');
    }
  });
});
