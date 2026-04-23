/**
 * Phase 7.8.5 — resume planner.
 *
 * Pure logic: given a state.json + on-disk artifact survey, decide what
 * `uaf resume` should do next. The CLI wraps this with the actual dispatch
 * (spec-wizard / roadmap-builder / orchestrator) and the user prompt.
 *
 * Keeping the planner pure means tests can drive every branch with synthetic
 * states, no LLM and no filesystem fixtures.
 */
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { isResumableState } from './checkpoint.js';
import type { WorkspaceState } from './state.js';

export type ResumeAction =
  | { kind: 'not-resumable'; reason: string }
  | { kind: 'already-complete' }
  | { kind: 'rerun-spec' }
  | { kind: 'rerun-roadmap' }
  | { kind: 'continue-build'; nextTaskId?: string };

export interface PlanResumeInput {
  state: WorkspaceState | null;
  /** Best-effort survey of which key files exist in the workspace. */
  files: {
    specMd: boolean;
    roadmapMd: boolean;
    designMd: boolean;
    packageJson: boolean;
  };
}

export interface PlanResumeResult {
  action: ResumeAction;
  /** Human-readable warnings to surface to the user (e.g. file missing / mismatch). */
  warnings: string[];
}

/**
 * Decide what to do for a resume.
 *
 * Decision table:
 *   no state.json       → not-resumable
 *   legacy (no phase)   → not-resumable
 *   resumable=false AND phase='complete' → already-complete
 *   phase='spec'        → rerun-spec (warn if spec.md unexpectedly exists already)
 *   phase='roadmap'     → rerun-roadmap (warn if roadmap.md missing or spec.md missing)
 *   phase='build' / 'interrupted' / 'failed' → continue-build with next pending task
 */
export function planResume(input: PlanResumeInput): PlanResumeResult {
  const warnings: string[] = [];
  const { state, files } = input;

  if (!state) {
    return {
      action: { kind: 'not-resumable', reason: 'no state.json' },
      warnings,
    };
  }
  if (state.phase === undefined && state.roadmap === undefined) {
    return {
      action: {
        kind: 'not-resumable',
        reason: 'legacy workspace (no phase/roadmap recorded)',
      },
      warnings,
    };
  }
  if (state.phase === 'complete' || state.resumable === false) {
    return { action: { kind: 'already-complete' }, warnings };
  }

  if (!isResumableState(state)) {
    return {
      action: { kind: 'not-resumable', reason: 'state marked non-resumable' },
      warnings,
    };
  }

  if (state.phase === 'spec') {
    if (files.specMd) {
      warnings.push('spec.md exists but state says phase=spec — re-running spec phase will overwrite it.');
    }
    return { action: { kind: 'rerun-spec' }, warnings };
  }

  if (state.phase === 'roadmap') {
    if (!files.specMd) {
      warnings.push('spec.md is missing — spec phase will be re-run before roadmap.');
      return { action: { kind: 'rerun-spec' }, warnings };
    }
    return { action: { kind: 'rerun-roadmap' }, warnings };
  }

  // phase ∈ { 'build', 'interrupted', 'failed' }
  if (!files.specMd) {
    warnings.push('spec.md is missing — falling back to spec phase.');
    return { action: { kind: 'rerun-spec' }, warnings };
  }
  if (!files.roadmapMd) {
    warnings.push('roadmap.md is missing — falling back to roadmap phase.');
    return { action: { kind: 'rerun-roadmap' }, warnings };
  }

  const nextPending = state.roadmap?.tasks.find(
    (t) => t.status === 'pending' || t.status === 'in-progress' || t.status === 'failed',
  );
  return {
    action: {
      kind: 'continue-build',
      ...(nextPending ? { nextTaskId: nextPending.id } : {}),
    },
    warnings,
  };
}

/**
 * Walk the workspace and report which key files are present. Pure I/O,
 * no schema parsing. Caller passes the result into `planResume`.
 */
export async function surveyWorkspaceFiles(
  workspaceDir: string,
): Promise<PlanResumeInput['files']> {
  const [specMd, roadmapMd, designMd, packageJson] = await Promise.all([
    fileExists(join(workspaceDir, 'spec.md')),
    fileExists(join(workspaceDir, 'roadmap.md')),
    fileExists(join(workspaceDir, 'design.md')),
    fileExists(join(workspaceDir, 'package.json')),
  ]);
  return { specMd, roadmapMd, designMd, packageJson };
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Format a one-line summary for the user prompt:
 *   "Project: X · phase=build · 7/12 tasks · resumable"
 */
export function formatProgressLine(state: WorkspaceState): string {
  const parts: string[] = [`phase=${state.phase ?? '?'}`];
  if (state.roadmap) {
    parts.push(`${state.roadmap.completedTasks}/${state.roadmap.totalTasks} tasks`);
  }
  parts.push(`status=${state.status}`);
  return parts.join(' · ');
}
