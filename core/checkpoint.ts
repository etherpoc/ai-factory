/**
 * Checkpoint writer (Phase 7.8, R12 常時再開可能原則).
 *
 * After every roadmap task completes (or fails), the orchestrator calls
 * `writeTaskCheckpoint` which:
 *
 *   1. Reads the current state.json.
 *   2. Updates the task's status / completedAt / costUsd / files lists.
 *   3. Recomputes `roadmap.completedTasks` and the top-level `phase`.
 *   4. Bumps `lastCheckpointAt`.
 *   5. Atomically writes state.json back (see core/utils/atomic-write.ts).
 *
 * The "right" place to define state.json's schema is `cli/utils/workspace.ts`
 * (where it has lived since Phase 7.5). We import the schema from there to
 * avoid duplicating it. This module is intentionally thin: it just orchestrates
 * read → mutate → atomic-write. Tests can stub the schema by overriding the
 * import or by calling the lower-level helpers directly.
 */
import {
  readWorkspaceState,
  writeWorkspaceState,
  type Phase,
  type RoadmapTask,
  type RoadmapTaskStatus,
  type WorkspaceState,
} from './state.js';

export interface TaskCheckpoint {
  taskId: string;
  status: Extract<RoadmapTaskStatus, 'completed' | 'failed' | 'in-progress' | 'skipped'>;
  /** USD cost incurred by this task. Added on top of any prior cost the task accrued. */
  costUsd?: number;
  /** Files this task created or modified inside the workspace. */
  filesAdded?: string[];
  filesModified?: string[];
  /** Free-form per-task metadata (agent role, retries, …). Merged into existing metadata. */
  metadata?: Record<string, unknown>;
  /** ISO timestamp; defaults to now. */
  ts?: string;
}

export interface WriteTaskCheckpointResult {
  state: WorkspaceState;
  task: RoadmapTask;
  /** True iff every required task is now `completed`. */
  allDone: boolean;
}

/**
 * Update a single roadmap task's status and atomically persist state.json.
 *
 * Throws if state.json doesn't exist, doesn't have a roadmap, or doesn't
 * contain a task with the given id. These are programmer errors — callers
 * should have written the roadmap before checkpointing tasks.
 */
export async function writeTaskCheckpoint(
  workspaceDir: string,
  cp: TaskCheckpoint,
): Promise<WriteTaskCheckpointResult> {
  const state = await readWorkspaceState(workspaceDir);
  if (!state) {
    throw new Error(`writeTaskCheckpoint: no state.json at ${workspaceDir}`);
  }
  if (!state.roadmap) {
    throw new Error(`writeTaskCheckpoint: state.json has no roadmap (workspace=${workspaceDir})`);
  }
  const idx = state.roadmap.tasks.findIndex((t) => t.id === cp.taskId);
  if (idx < 0) {
    throw new Error(`writeTaskCheckpoint: unknown taskId "${cp.taskId}"`);
  }

  const now = cp.ts ?? new Date().toISOString();
  const prev = state.roadmap.tasks[idx]!;
  const isTerminal = cp.status === 'completed' || cp.status === 'skipped';

  const updated: RoadmapTask = {
    ...prev,
    status: cp.status,
    ...(cp.status === 'in-progress' && !prev.startedAt ? { startedAt: now } : {}),
    ...(isTerminal ? { completedAt: now } : {}),
    ...(cp.costUsd !== undefined
      ? { costUsd: +(((prev.costUsd ?? 0) + cp.costUsd).toFixed(6)) }
      : {}),
    ...(cp.filesAdded ? { filesAdded: dedup([...(prev.filesAdded ?? []), ...cp.filesAdded]) } : {}),
    ...(cp.filesModified
      ? { filesModified: dedup([...(prev.filesModified ?? []), ...cp.filesModified]) }
      : {}),
    ...(cp.metadata ? { metadata: { ...(prev.metadata ?? {}), ...cp.metadata } } : {}),
  };

  const tasks = state.roadmap.tasks.map((t, i) => (i === idx ? updated : t));
  const completedTasks = tasks.filter((t) => t.status === 'completed').length;
  const failedTasks = tasks.filter((t) => t.status === 'failed').length;
  const allDone = completedTasks + tasks.filter((t) => t.status === 'skipped').length === tasks.length;

  // currentTaskId tracks the in-progress task; clear it when the task ends.
  const nextCurrent: string | undefined =
    cp.status === 'in-progress'
      ? cp.taskId
      : state.roadmap.currentTaskId === cp.taskId
        ? undefined
        : state.roadmap.currentTaskId;

  // Phase transitions:
  //   - any failed task → 'failed' (so resume can find it)
  //   - all done → 'complete'
  //   - otherwise stay in 'build' (or whatever was already set)
  const nextPhase: Phase = failedTasks > 0 ? 'failed' : allDone ? 'complete' : (state.phase ?? 'build');

  // Rebuild roadmap from scratch so currentTaskId is dropped cleanly when undefined.
  const nextRoadmap: WorkspaceState['roadmap'] = {
    path: state.roadmap.path,
    createdAt: state.roadmap.createdAt,
    totalTasks: state.roadmap.totalTasks,
    completedTasks,
    tasks,
    ...(nextCurrent !== undefined ? { currentTaskId: nextCurrent } : {}),
    ...(state.roadmap.estimatedCostUsd !== undefined
      ? { estimatedCostUsd: state.roadmap.estimatedCostUsd }
      : {}),
    ...(state.roadmap.estimatedDurationMin !== undefined
      ? { estimatedDurationMin: state.roadmap.estimatedDurationMin }
      : {}),
  };

  const next: WorkspaceState = {
    ...state,
    phase: nextPhase,
    lastRunAt: now,
    lastCheckpointAt: now,
    resumable: !allDone && failedTasks === 0,
    roadmap: nextRoadmap,
  };

  await writeWorkspaceState(workspaceDir, next);
  return { state: next, task: updated, allDone };
}

/**
 * Mark the project as interrupted (Ctrl+C, crash) without changing any task
 * statuses. Sets `phase='interrupted'` and `resumable=true` so `uaf resume`
 * can pick it up.
 */
export async function writeInterruptCheckpoint(
  workspaceDir: string,
  reason: string,
): Promise<WorkspaceState | null> {
  const state = await readWorkspaceState(workspaceDir);
  if (!state) return null;
  const now = new Date().toISOString();
  const next: WorkspaceState = {
    ...state,
    phase: 'interrupted',
    status: 'interrupted',
    lastRunAt: now,
    lastCheckpointAt: now,
    resumable: true,
  };
  // Stash the reason in the in-progress task's metadata if there is one.
  if (next.roadmap?.currentTaskId) {
    const id = next.roadmap.currentTaskId;
    next.roadmap = {
      ...next.roadmap,
      tasks: next.roadmap.tasks.map((t) =>
        t.id === id ? { ...t, metadata: { ...(t.metadata ?? {}), interruptReason: reason } } : t,
      ),
    };
  }
  await writeWorkspaceState(workspaceDir, next);
  return next;
}

/**
 * Fast-path query: is this workspace resumable?
 *  - state.json exists
 *  - has a roadmap
 *  - resumable !== false (i.e. true or undefined-but-not-complete)
 *  - phase ∈ {spec, roadmap, build, interrupted, failed}
 */
export function isResumableState(state: WorkspaceState | null): boolean {
  if (!state) return false;
  if (state.resumable === false) return false;
  if (state.phase === 'complete') return false;
  if (!state.roadmap && state.phase !== 'spec' && state.phase !== 'roadmap') return false;
  return true;
}

function dedup<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}
