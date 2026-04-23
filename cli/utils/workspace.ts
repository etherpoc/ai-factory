/**
 * Workspace utilities for the uaf CLI (Phase 7.5, refactored Phase 7.8).
 *
 * The state.json schema and atomic read/write live in `core/state.ts` now
 * that the orchestrator depends on them too (R12 — Phase 7.8 checkpoints).
 * This file keeps the CLI-specific wrappers: project discovery (`findProject`,
 * `listProjects`) and snapshot helpers (`snapshotDir`, `listSnapshots`).
 *
 * `WorkspaceState`, `IterationEntry`, `WorkspaceStateSchema`, and the read /
 * write / upsert helpers are re-exported from `core/state.ts` so existing
 * callers don't have to change their import path.
 */
import { readdir, stat, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { UafError } from '../ui/errors.js';
import { readWorkspaceState, type WorkspaceState } from '../../core/state.js';

// Re-export everything CLI callers used to import from here. Keeping the
// public surface stable lets create.ts / iterate.ts / list.ts stay untouched.
export {
  IterationEntrySchema,
  AssetsSummarySchema,
  WorkspaceStateSchema,
  RoadmapTaskSchema,
  RoadmapMetaSchema,
  SpecMetaSchema,
  PhaseSchema,
  RoadmapTaskStatusSchema,
  WORKSPACE_STATE_FILE,
  readWorkspaceState,
  writeWorkspaceState,
  upsertWorkspaceState,
  isLegacyState,
  type IterationEntry,
  type WorkspaceState,
  type SpecMeta,
  type RoadmapMeta,
  type RoadmapTask,
  type RoadmapTaskStatus,
  type Phase,
  type UpsertStateInput,
} from '../../core/state.js';

export const SNAPSHOT_ROOT = '.snapshots';

// ---------------------------------------------------------------------------
// Project discovery
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
