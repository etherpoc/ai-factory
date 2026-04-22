/**
 * Workspace utilities for the uaf CLI (Phase 7.5).
 *
 * Reads and writes `workspace/<proj-id>/state.json`, which is a CLI-layer
 * side-channel that records what each workspace was for. The orchestrator
 * itself keeps writing REPORT.md + metrics.jsonl unchanged; state.json is
 * written by `uaf create` after the orchestrator returns and is consulted
 * by `uaf list`, `uaf iterate`, `uaf open`, and `uaf clean`.
 *
 * Keeping this out of `core/` preserves the R2 boundary (CLI depends on core,
 * not the other way around) and avoids coupling orchestrator changes to the
 * state schema.
 */
import { readFile, writeFile, readdir, stat, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { UafError } from '../ui/errors.js';

export const WORKSPACE_STATE_FILE = 'state.json';
export const SNAPSHOT_ROOT = '.snapshots';

/**
 * Schema for `workspace/<proj-id>/state.json`. One file per workspace.
 * Iterations accumulate on `iterate` — index 0 is always the initial `create`.
 */
export const IterationEntrySchema = z.object({
  ts: z.string(),
  mode: z.enum(['create', 'iterate']),
  request: z.string(),
  /** USD cost for this iteration (from metrics.jsonl). */
  costUsd: z.number().optional(),
  /** Orchestrator result flags. */
  done: z.boolean().optional(),
  overall: z.number().optional(),
  haltReason: z.string().optional(),
  /** Diff produced by the snapshotter (iterate only). */
  diff: z
    .object({
      added: z.array(z.string()).default([]),
      modified: z.array(z.string()).default([]),
      deleted: z.array(z.string()).default([]),
    })
    .optional(),
  /** Path of the pre-iterate snapshot, if taken. */
  snapshotPath: z.string().optional(),
  /** Test counts at the end of this iteration, when available. */
  testsPassed: z.number().optional(),
  testsFailed: z.number().optional(),
});

// Phase 11.a: aggregated summary of creative-agent outputs. Populated by
// `uaf create` / `uaf iterate` post-run. All fields optional so pre-Phase-11.a
// state.json files still load.
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

export const WorkspaceStateSchema = z.object({
  projectId: z.string(),
  recipeType: z.string(),
  originalRequest: z.string(),
  createdAt: z.string(),
  lastRunAt: z.string(),
  status: z.enum(['completed', 'halted', 'failed', 'in-progress']),
  iterations: z.array(IterationEntrySchema),
  assets: AssetsSummarySchema,
});

export type IterationEntry = z.infer<typeof IterationEntrySchema>;
export type WorkspaceState = z.infer<typeof WorkspaceStateSchema>;

// ---------------------------------------------------------------------------
// I/O
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
  // Treat both JSON parse errors and schema violations as "no state" — the
  // file is a convenience, not a correctness contract. `uaf list` falls back
  // to mtime when state is absent.
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
  await writeFile(path, JSON.stringify(validated, null, 2) + '\n', 'utf8');
}

/**
 * Upsert an iteration entry and update the top-level status/lastRunAt. When
 * the file is absent we create it from scratch (create's first run).
 */
export interface UpsertStateInput {
  projectId: string;
  recipeType: string;
  originalRequest: string;
  entry: IterationEntry;
  status: WorkspaceState['status'];
  /** Phase 11.a: optional creative-agent outputs. Replaces the whole `assets` block when provided. */
  assets?: import('zod').z.infer<typeof AssetsSummarySchema>;
}

export async function upsertWorkspaceState(
  workspaceDir: string,
  input: UpsertStateInput,
): Promise<WorkspaceState> {
  const now = new Date().toISOString();
  const existing = await readWorkspaceState(workspaceDir);
  const state: WorkspaceState = existing
    ? {
        ...existing,
        status: input.status,
        lastRunAt: now,
        iterations: [...existing.iterations, input.entry],
        ...(input.assets !== undefined ? { assets: input.assets } : {}),
      }
    : {
        projectId: input.projectId,
        recipeType: input.recipeType,
        originalRequest: input.originalRequest,
        createdAt: now,
        lastRunAt: now,
        status: input.status,
        iterations: [input.entry],
        ...(input.assets !== undefined ? { assets: input.assets } : {}),
      };
  await writeWorkspaceState(workspaceDir, state);
  return state;
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

export interface ProjectEntry {
  projectId: string;
  dir: string;
  /** state.json contents if present. */
  state: WorkspaceState | null;
  /** Fallback timestamps when state.json is missing. */
  mtimeMs: number;
}

/**
 * List projects in `<workspaceBase>`. Entries without state.json are still
 * returned with `state: null` so `uaf list` can show old Phase 6 workspaces.
 * Hidden directories (starting with `.`) are skipped — that's where
 * `.snapshots/` lives.
 */
export async function listProjects(workspaceBase: string): Promise<ProjectEntry[]> {
  let entries: string[];
  try {
    entries = await readdir(workspaceBase);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const result: ProjectEntry[] = [];
  for (const name of entries) {
    if (name.startsWith('.')) continue; // skip .snapshots and friends
    const dir = join(workspaceBase, name);
    let info: Awaited<ReturnType<typeof stat>>;
    try {
      info = await stat(dir);
    } catch {
      continue;
    }
    if (!info.isDirectory()) continue;
    const state = await readWorkspaceState(dir);
    result.push({ projectId: name, dir, state, mtimeMs: info.mtimeMs });
  }
  // Newest first.
  result.sort((a, b) => {
    const aTs = a.state ? Date.parse(a.state.lastRunAt) : a.mtimeMs;
    const bTs = b.state ? Date.parse(b.state.lastRunAt) : b.mtimeMs;
    return bTs - aTs;
  });
  return result;
}

export async function findProject(
  workspaceBase: string,
  projectId: string,
): Promise<ProjectEntry> {
  const dir = join(workspaceBase, projectId);
  let info: Awaited<ReturnType<typeof stat>>;
  try {
    info = await stat(dir);
  } catch {
    throw new UafError(`project not found: ${projectId}`, {
      code: 'PROJECT_NOT_FOUND',
      details: { workspaceBase, projectId },
      hint: 'Run `uaf list` to see available project ids.',
    });
  }
  if (!info.isDirectory()) {
    throw new UafError(`not a directory: ${dir}`, {
      code: 'PROJECT_NOT_FOUND',
    });
  }
  const state = await readWorkspaceState(dir);
  return { projectId, dir, state, mtimeMs: info.mtimeMs };
}

// ---------------------------------------------------------------------------
// Snapshot helpers
// ---------------------------------------------------------------------------

export function snapshotDir(workspaceBase: string, projectId: string, ts: Date): string {
  const stamp =
    ts.getFullYear().toString() +
    String(ts.getMonth() + 1).padStart(2, '0') +
    String(ts.getDate()).padStart(2, '0') +
    String(ts.getHours()).padStart(2, '0') +
    String(ts.getMinutes()).padStart(2, '0') +
    String(ts.getSeconds()).padStart(2, '0');
  return join(workspaceBase, SNAPSHOT_ROOT, `${projectId}-${stamp}`);
}

export async function ensureSnapshotRoot(workspaceBase: string): Promise<string> {
  const p = join(workspaceBase, SNAPSHOT_ROOT);
  await mkdir(p, { recursive: true });
  return p;
}

/** Scan `<workspaceBase>/.snapshots/` for files older than cutoff. */
export interface SnapshotEntry {
  name: string;
  dir: string;
  mtimeMs: number;
  /** Parsed from the name: `<projectId>-<timestamp>`. */
  projectId: string | null;
}

export async function listSnapshots(workspaceBase: string): Promise<SnapshotEntry[]> {
  const p = join(workspaceBase, SNAPSHOT_ROOT);
  let entries: string[];
  try {
    entries = await readdir(p);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const out: SnapshotEntry[] = [];
  for (const name of entries) {
    const dir = join(p, name);
    let info: Awaited<ReturnType<typeof stat>>;
    try {
      info = await stat(dir);
    } catch {
      continue;
    }
    if (!info.isDirectory()) continue;
    // Parse out the projectId by stripping the trailing -YYYYMMDDhhmmss.
    const match = /^(.+)-\d{14}$/.exec(name);
    out.push({
      name,
      dir,
      mtimeMs: info.mtimeMs,
      projectId: match ? match[1]! : null,
    });
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return out;
}
