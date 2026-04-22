/**
 * Phase 7.5 regression for cli/utils/snapshot.ts.
 *
 * Verifies:
 *   - mtime+size+sha256 is computed over the workspace, with excludes
 *   - diff correctly classifies added / modified / deleted
 *   - copyToSnapshot produces a physical copy with excludes honored
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  copyToSnapshot,
  diffSnapshots,
  snapshotWorkspace,
} from '../../cli/utils/snapshot.js';

let base: string;
let ws: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'uaf-snap-'));
  ws = join(base, 'proj-1');
  await mkdir(ws, { recursive: true });
  await mkdir(join(ws, 'src'), { recursive: true });
  await writeFile(join(ws, 'src', 'main.ts'), 'export const v = 1;\n');
  await writeFile(join(ws, 'src', 'util.ts'), 'export const u = 1;\n');
  await writeFile(join(ws, 'README.md'), '# proj\n');
  // Should be excluded from the hash:
  await mkdir(join(ws, 'node_modules', 'pkg'), { recursive: true });
  await writeFile(join(ws, 'node_modules', 'pkg', 'index.js'), 'module.exports = {};\n');
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('cli/utils/snapshot — snapshotWorkspace', () => {
  it('captures tracked files, excludes node_modules', async () => {
    const snap = await snapshotWorkspace(ws);
    const keys = [...snap.keys()].sort();
    expect(keys).toEqual(['README.md', 'src/main.ts', 'src/util.ts']);
    expect(keys.some((k) => k.includes('node_modules'))).toBe(false);
  });

  it('records size + sha256 for each file', async () => {
    const snap = await snapshotWorkspace(ws);
    const main = snap.get('src/main.ts')!;
    expect(main.size).toBeGreaterThan(0);
    expect(main.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('cli/utils/snapshot — diffSnapshots', () => {
  it('classifies added/modified/deleted', async () => {
    const before = await snapshotWorkspace(ws);

    // add a file
    await writeFile(join(ws, 'src', 'new.ts'), 'hi\n');
    // modify a file
    await writeFile(join(ws, 'src', 'main.ts'), 'export const v = 2;\n');
    // delete a file
    await rm(join(ws, 'src', 'util.ts'));

    const after = await snapshotWorkspace(ws);
    const d = diffSnapshots(before, after);
    expect(d.added).toContain('src/new.ts');
    expect(d.modified).toContain('src/main.ts');
    expect(d.deleted).toContain('src/util.ts');
    // bytesDelta: +new + modified_delta - deleted
    expect(typeof d.bytesDelta).toBe('number');
  });

  it('returns empty arrays when nothing changed', async () => {
    const before = await snapshotWorkspace(ws);
    const after = await snapshotWorkspace(ws);
    const d = diffSnapshots(before, after);
    // mtime can shift between snapshots if the OS updates atime on read, but
    // sha256 should still match → no modifications reported.
    expect(d.added).toEqual([]);
    expect(d.modified).toEqual([]);
    expect(d.deleted).toEqual([]);
  });
});

describe('cli/utils/snapshot — copyToSnapshot', () => {
  it('creates a physical copy under .snapshots/', async () => {
    const dest = await copyToSnapshot(base, 'proj-1', ws);
    expect(dest).toMatch(/[\/\\]\.snapshots[\/\\]proj-1-\d{14}$/);
    const readme = await readFile(join(dest, 'README.md'), 'utf8');
    expect(readme).toBe('# proj\n');
  });

  it('excludes node_modules from the copy', async () => {
    const dest = await copyToSnapshot(base, 'proj-1', ws);
    let err: unknown;
    try {
      await readFile(join(dest, 'node_modules', 'pkg', 'index.js'));
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
  });
});
