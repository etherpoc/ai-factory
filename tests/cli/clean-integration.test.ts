/**
 * Phase 7.7 integration tests for `uaf clean`.
 *
 * Covers:
 *   - --dry-run does not touch the filesystem
 *   - --older-than selects only old workspaces
 *   - snapshots are included in the selection
 *   - --yes skips the confirmation prompt
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { access, mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runClean } from '../../cli/commands/clean.js';
import { writeWorkspaceState } from '../../cli/utils/workspace.js';

let tmp: string;
let savedCwd: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'uaf-clean-'));
  await mkdir(join(tmp, 'workspace'), { recursive: true });
  savedCwd = process.cwd();
  process.chdir(tmp);
});
afterEach(async () => {
  process.chdir(savedCwd);
  await rm(tmp, { recursive: true, force: true });
});

async function seedOldProject(id: string, ageDays: number): Promise<string> {
  const dir = join(tmp, 'workspace', id);
  await mkdir(dir, { recursive: true });
  const oldTs = new Date(Date.now() - ageDays * 24 * 60 * 60_000).toISOString();
  await writeWorkspaceState(dir, {
    projectId: id,
    recipeType: 'cli',
    originalRequest: 'x',
    createdAt: oldTs,
    lastRunAt: oldTs,
    status: 'completed',
    iterations: [{ ts: oldTs, mode: 'create', request: 'x' }],
  });
  return dir;
}

async function seedOldSnapshot(id: string, ageDays: number): Promise<string> {
  const dir = join(tmp, 'workspace', '.snapshots', id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'marker'), 'x');
  const t = (Date.now() - ageDays * 24 * 60 * 60_000) / 1000;
  await utimes(dir, t, t);
  return dir;
}

describe('uaf clean — integration', () => {
  it('says nothing to clean when all workspaces are fresh', async () => {
    await seedOldProject('fresh', 1); // 1 day old
    await runClean({ olderThan: '30d', dryRun: true });
    // Should still be there (dry-run or otherwise).
    await expect(access(join(tmp, 'workspace', 'fresh'))).resolves.toBeUndefined();
  });

  it('dry-run never deletes', async () => {
    const dir = await seedOldProject('stale', 60);
    await runClean({ olderThan: '30d', dryRun: true });
    await expect(access(dir)).resolves.toBeUndefined();
  });

  it('deletes projects older than threshold when --yes is passed', async () => {
    const stale = await seedOldProject('stale', 60);
    const fresh = await seedOldProject('fresh', 1);
    await runClean({ olderThan: '30d', yes: true });
    let staleAlive = true;
    try {
      await access(stale);
    } catch {
      staleAlive = false;
    }
    expect(staleAlive).toBe(false);
    await expect(access(fresh)).resolves.toBeUndefined();
  });

  it('includes snapshots in the deletion scope', async () => {
    const snap = await seedOldSnapshot('proj-20260101000000', 60);
    await runClean({ olderThan: '30d', yes: true });
    let alive = true;
    try {
      await access(snap);
    } catch {
      alive = false;
    }
    expect(alive).toBe(false);
  });
});
