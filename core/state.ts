/**
 * `workspace/<proj-id>/state.json` schema and core I/O.
 *
 * Phase 7.5 introduced state.json as a CLI-side convenience. Phase 7.8
 * promotes it to a load-bearing artifact: the orchestrator updates it at
 * every roadmap-task completion so `uaf resume` can pick up where a crash
 * or Ctrl+C left off.
 *
 * Because both core (orchestrator, checkpoint writer) and CLI (list, status,
 * cost) read this file now, the schema and the atomic read/write live here
 * in core/. CLI-specific wrappers (findProject with UafError, listProjects,
 * snapshots) stay in cli/utils/workspace.ts and re-export these types.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { atomicWrite } from './utils/atomic-write.js';

export const WORKSPACE_STATE_FILE = 'state.json';

// ---------------------------------------------------------------------------
// Iteration log (Phase 7.5)
// ---------------------------------------------------------------------------

export const IterationEntrySchema = z.object({
  ts: z.string(),
  mode: z.enum(['create', 'iterate']),
  request: z.string(),
  costUsd: z.number().optional(),
  done: z.boolean().optional(),
  overall: z.number().optional(),
  haltReason: z.string().optional(),
  diff: z
    .object({
      added: z.array(z.string()).default([]),
      modified: z.array(z.string()).default([]),
      deleted: z.array(z.string()).default([]),
    })
    .optional(),
  snapshotPath: z.string().optional(),
  testsPassed: z.number().optional(),
  testsFailed: z.number().optional(),
});

// ---------------------------------------------------------------------------
// Creative-agent outputs (Phase 11.a)
// ---------------------------------------------------------------------------

export const AssetsSummarySchema = z
  .object({
    images: z
      .object({
        count: z.number().int().nonnegative(),
        totalCostUsd: z.number().nonnegative(),
        manifestPath: z.string().optional(),
      })
      .optional(),
    audio: z
      .object({
        count: z.number().int().nonnegative(),
        totalCostUsd: z.number().nonnegative(),
        manifestPath: z.string().optional(),
      })
      .optional(),
    copy: z
      .object({
        path: z.string(),
        keys: z.number().int().nonnegative().optional(),
      })
      .optional(),
    critique: z
      .object({
        path: z.string(),
        overallScore: z.number().optional(),
      })
      .optional(),
  })
  .optional();

// ---------------------------------------------------------------------------
// Phase 7.8 — spec / roadmap / checkpoint
// All fields are optional so pre-7.8 state.json files still validate.
// ---------------------------------------------------------------------------

export const SpecMetaSchema = z.object({
  path: z.string(),
  createdAt: z.string(),
  /** How many Q&A turns it took. 0 when --spec-file was used. */
  dialogTurns: z.number().int().nonnegative(),
  /** Has the user OK'd it? Build phase will not run until true. */
  userApproved: z.boolean(),
});

export const RoadmapTaskStatusSchema = z.enum([
  'pending',
  'in-progress',
  'completed',
  'failed',
  'skipped',
]);

export const RoadmapTaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: RoadmapTaskStatusSchema,
  /** Phase X group from roadmap.md, display only. */
  phase: z.string().optional(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  costUsd: z.number().nonnegative().optional(),
  filesAdded: z.array(z.string()).optional(),
  filesModified: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const RoadmapMetaSchema = z.object({
  path: z.string(),
  createdAt: z.string(),
  totalTasks: z.number().int().nonnegative(),
  completedTasks: z.number().int().nonnegative(),
  currentTaskId: z.string().optional(),
  tasks: z.array(RoadmapTaskSchema),
  estimatedCostUsd: z.number().nonnegative().optional(),
  estimatedDurationMin: z.number().nonnegative().optional(),
});

export const PhaseSchema = z.enum([
  'spec',
  'roadmap',
  'build',
  'complete',
  'failed',
  'interrupted',
]);

// ---------------------------------------------------------------------------
// Phase 7.8.6 — preview process tracking
// ---------------------------------------------------------------------------

export const PreviewSchema = z.object({
  pid: z.number().int().positive(),
  /** Port the dev server is bound to, when known. */
  port: z.number().int().positive().optional(),
  /** Primary URL the user should open. Often `http://localhost:<port>/`. */
  url: z.string().optional(),
  startedAt: z.string(),
  /** True when launched with --detach (process is unrelated to current shell). */
  detached: z.boolean(),
  /** Command line we spawned, recorded for diagnostics + uaf doctor. */
  command: z.string(),
});

export type PreviewState = z.infer<typeof PreviewSchema>;

export const WorkspaceStateSchema = z.object({
  projectId: z.string(),
  recipeType: z.string(),
  originalRequest: z.string(),
  createdAt: z.string(),
  lastRunAt: z.string(),
  status: z.enum(['completed', 'halted', 'failed', 'in-progress', 'interrupted']),
  iterations: z.array(IterationEntrySchema),
  assets: AssetsSummarySchema,
  // Phase 7.8 additions — all optional for backward compat.
  phase: PhaseSchema.optional(),
  spec: SpecMetaSchema.optional(),
  roadmap: RoadmapMetaSchema.optional(),
  resumable: z.boolean().optional(),
  lastCheckpointAt: z.string().optional(),
  // Phase 7.8.6 — current dev-server / preview process. Cleared by `--stop`.
  preview: PreviewSchema.optional(),
});

export type IterationEntry = z.infer<typeof IterationEntrySchema>;
export type WorkspaceState = z.infer<typeof WorkspaceStateSchema>;
export type SpecMeta = z.infer<typeof SpecMetaSchema>;
export type RoadmapMeta = z.infer<typeof RoadmapMetaSchema>;
export type RoadmapTask = z.infer<typeof RoadmapTaskSchema>;
export type RoadmapTaskStatus = z.infer<typeof RoadmapTaskStatusSchema>;
export type Phase = z.infer<typeof PhaseSchema>;

// ---------------------------------------------------------------------------
// I/O — atomic, schema-validated
// ---------------------------------------------------------------------------

export async function readWorkspaceState(workspaceDir: string): Promise<WorkspaceState | null> {
  const path = join(workspaceDir, WORKSPACE_STATE_FILE);
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  // Treat parse errors and schema violations as "no state" — the file is a
  // convenience layer, not a correctness contract. Callers fall back to mtime.
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = WorkspaceStateSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export async function writeWorkspaceState(
  workspaceDir: string,
  state: WorkspaceState,
): Promise<void> {
  const validated = WorkspaceStateSchema.parse(state);
  const path = join(workspaceDir, WORKSPACE_STATE_FILE);
  await atomicWrite(path, JSON.stringify(validated, null, 2) + '\n');
}

export interface UpsertStateInput {
  projectId: string;
  recipeType: string;
  originalRequest: string;
  entry?: IterationEntry;
  status: WorkspaceState['status'];
  assets?: z.infer<typeof AssetsSummarySchema>;
  // ---- Phase 7.8 ----------------------------------------------------------
  phase?: Phase;
  spec?: SpecMeta;
  roadmap?: RoadmapMeta;
  resumable?: boolean;
  lastCheckpointAt?: string;
  // ---- Phase 7.8.6 --------------------------------------------------------
  /**
   * Pass the literal `null` to clear an existing preview (used by --stop).
   * Pass an object to set/replace it. Omit to leave it untouched.
   */
  preview?: PreviewState | null;
}

/**
 * Read-modify-write helper. Appends `entry` to `iterations` if provided,
 * otherwise leaves the iteration log untouched (useful for spec/roadmap
 * phase transitions that aren't a full sprint). Always atomic.
 */
export async function upsertWorkspaceState(
  workspaceDir: string,
  input: UpsertStateInput,
): Promise<WorkspaceState> {
  const now = new Date().toISOString();
  const existing = await readWorkspaceState(workspaceDir);
  const baseIterations = existing?.iterations ?? [];
  const iterations = input.entry ? [...baseIterations, input.entry] : baseIterations;
  // Preview is special: `null` means "clear the field"; `undefined` means
  // "leave whatever was there". Build the override and a delete flag.
  const previewSet = input.preview !== undefined && input.preview !== null;
  const previewClear = input.preview === null;

  const baseExisting: WorkspaceState | undefined = existing ?? undefined;
  const state: WorkspaceState = baseExisting
    ? {
        ...baseExisting,
        status: input.status,
        lastRunAt: now,
        iterations,
        ...(input.assets !== undefined ? { assets: input.assets } : {}),
        ...(input.phase !== undefined ? { phase: input.phase } : {}),
        ...(input.spec !== undefined ? { spec: input.spec } : {}),
        ...(input.roadmap !== undefined ? { roadmap: input.roadmap } : {}),
        ...(input.resumable !== undefined ? { resumable: input.resumable } : {}),
        ...(input.lastCheckpointAt !== undefined
          ? { lastCheckpointAt: input.lastCheckpointAt }
          : {}),
        ...(previewSet ? { preview: input.preview as PreviewState } : {}),
      }
    : {
        projectId: input.projectId,
        recipeType: input.recipeType,
        originalRequest: input.originalRequest,
        createdAt: now,
        lastRunAt: now,
        status: input.status,
        iterations,
        ...(input.assets !== undefined ? { assets: input.assets } : {}),
        ...(input.phase !== undefined ? { phase: input.phase } : {}),
        ...(input.spec !== undefined ? { spec: input.spec } : {}),
        ...(input.roadmap !== undefined ? { roadmap: input.roadmap } : {}),
        ...(input.resumable !== undefined ? { resumable: input.resumable } : {}),
        ...(input.lastCheckpointAt !== undefined
          ? { lastCheckpointAt: input.lastCheckpointAt }
          : {}),
        ...(previewSet ? { preview: input.preview as PreviewState } : {}),
      };
  if (previewClear) {
    delete (state as { preview?: PreviewState }).preview;
  }
  await writeWorkspaceState(workspaceDir, state);
  return state;
}

/**
 * True for any pre-Phase-7.8 workspace: state.json exists but has no
 * `phase` and no `roadmap`. `uaf list --incomplete` flags these as legacy.
 */
export function isLegacyState(state: WorkspaceState | null): boolean {
  if (!state) return false;
  return state.phase === undefined && state.roadmap === undefined;
}
