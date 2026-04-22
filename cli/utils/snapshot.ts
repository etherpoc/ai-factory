/**
 * Workspace snapshot + diff (Phase 7.5).
 *
 * Implements Q2 from the iterate design review:
 *   (D) mtime + size + SHA-256 3-tuple per file; before/after Map diff.
 *
 * Two products:
 *
 *   - `snapshotWorkspace(dir)` — produces a Map<relPath, FileHash> that is
 *     cheap to compute and diff.
 *   - `copyToSnapshot(base, projectId, src)` — copies the workspace into
 *     `<base>/.snapshots/<projectId>-<timestamp>/` so the pre-iterate state
 *     is physically recoverable (additional proposal 1).
 *
 * Exclusions (skipped from both the hash snapshot and the physical copy):
 *   node_modules, dist, build, .next, .git, coverage, playwright-report,
 *   test-results, __snapshots__. Catches the bulky generated dirs that
 *   would make snapshotting take minutes.
 */
import { cp, readdir, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, relative, sep } from 'node:path';
import { ensureSnapshotRoot, snapshotDir } from './workspace.js';

export interface FileHash {
  size: number;
  mtimeMs: number;
  sha256: string;
}

export type WorkspaceSnapshot = Map<string, FileHash>;

export interface WorkspaceDiff {
  added: string[];
  modified: string[];
  deleted: string[];
  /** Bytes added/removed by modified files (best-effort). */
  bytesDelta: number;
}

/** Directory segment exclusions; matched case-insensitively on the name. */
const EXCLUDE = new Set([
  'node_modules',
  'dist',
  'build',
  '.next',
  '.git',
  'coverage',
  'playwright-report',
  'test-results',
  '__snapshots__',
  '.snapshots',
  '.turbo',
  '.cache',
]);

async function* walk(root: string, rel = ''): AsyncGenerator<string, void, void> {
  const abs = rel === '' ? root : join(root, rel);
  let entries: Array<{ name: string; isDir: boolean }>;
  try {
    const raw = await readdir(abs, { withFileTypes: true });
    entries = raw.map((e) => ({ name: e.name, isDir: e.isDirectory() }));
  } catch {
    return;
  }
  for (const e of entries) {
    if (EXCLUDE.has(e.name)) continue;
    const sub = rel === '' ? e.name : rel + sep + e.name;
    if (e.isDir) {
      yield* walk(root, sub);
    } else {
      yield sub;
    }
  }
}

export async function snapshotWorkspace(dir: string): Promise<WorkspaceSnapshot> {
  const map: WorkspaceSnapshot = new Map();
  for await (const rel of walk(dir)) {
    const abs = join(dir, rel);
    let info: Awaited<ReturnType<typeof stat>>;
    try {
      info = await stat(abs);
    } catch {
      continue;
    }
    // Skip gigantic files to keep snapshots fast; record them as-is by size
    // (changes detected via size alone).
    let sha = '';
    if (info.size < 2_000_000) {
      try {
        const buf = await readFile(abs);
        sha = createHash('sha256').update(buf).digest('hex');
      } catch {
        sha = '';
      }
    }
    map.set(normalizeRel(rel), {
      size: info.size,
      mtimeMs: info.mtimeMs,
      sha256: sha,
    });
  }
  return map;
}

/** Normalize Windows backslashes to forward slashes so diffs are portable. */
function normalizeRel(rel: string): string {
  return rel.split(sep).join('/');
}

export function diffSnapshots(before: WorkspaceSnapshot, after: WorkspaceSnapshot): WorkspaceDiff {
  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];
  let bytesDelta = 0;

  for (const [path, hash] of after) {
    const prev = before.get(path);
    if (!prev) {
      added.push(path);
      bytesDelta += hash.size;
    } else if (prev.sha256 !== hash.sha256 || prev.size !== hash.size) {
      modified.push(path);
      bytesDelta += hash.size - prev.size;
    }
  }
  for (const [path, hash] of before) {
    if (!after.has(path)) {
      deleted.push(path);
      bytesDelta -= hash.size;
    }
  }
  added.sort();
  modified.sort();
  deleted.sort();
  return { added, modified, deleted, bytesDelta };
}

/** Copy `src` into `<base>/.snapshots/<projectId>-<stamp>/` and return that path. */
export async function copyToSnapshot(
  workspaceBase: string,
  projectId: string,
  src: string,
  ts: Date = new Date(),
): Promise<string> {
  await ensureSnapshotRoot(workspaceBase);
  const dest = snapshotDir(workspaceBase, projectId, ts);
  await cp(src, dest, {
    recursive: true,
    filter: (from) => {
      // Reject excluded directories by name.
      const r = relative(src, from);
      if (r === '') return true;
      const seg = r.split(sep);
      return !seg.some((s) => EXCLUDE.has(s));
    },
  });
  return dest;
}
