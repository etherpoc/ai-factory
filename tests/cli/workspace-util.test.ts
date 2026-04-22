/**
 * Phase 7.5 regression for cli/utils/workspace.ts.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UafError } from '../../cli/ui/errors.js';
import {
  findProject,
  listProjects,
  listSnapshots,
  readWorkspaceState,
  snapshotDir,
  upsertWorkspaceState,
  writeWorkspaceState,
  type WorkspaceState,
} from '../../cli/utils/workspace.js';

let base: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'uaf-ws-'));
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

function sampleState(pid: string): WorkspaceState {
  return {
    projectId: pid,
    recipeType: '2d-game',
    originalRequest: 'make a clicker',
    createdAt: '2026-04-22T00:00:00.000Z',
    lastRunAt: '2026-04-22T00:10:00.000Z',
    status: 'completed',
    iterations: [
      { ts: '2026-04-22T00:00:00.000Z', mode: 'create', request: 'make a clicker', done: true, overall: 95 },
    ],
  };
}

describe('cli/utils/workspace — state.json I/O', () => {
  it('read returns null when file is missing', async () => {
    const dir = join(base, 'p1');
    await mkdir(dir);
    const state = await readWorkspaceState(dir);
    expect(state).toBeNull();
  });

  it('read returns the written value (round-trip)', async () => {
    const dir = join(base, 'p1');
    await mkdir(dir);
    const state = sampleState('p1');
    await writeWorkspaceState(dir, state);
    expect(await readWorkspaceState(dir)).toEqual(state);
  });

  it('corrupt state.json yields null (graceful)', async () => {
    const dir = join(base, 'p1');
    await mkdir(dir);
    await writeFile(join(dir, 'state.json'), '{broken json');
    expect(await readWorkspaceState(dir)).toBeNull();
  });

  it('upsert creates on first call', async () => {
    const dir = join(base, 'p2');
    await mkdir(dir);
    const out = await upsertWorkspaceState(dir, {
      projectId: 'p2',
      recipeType: '2d-game',
      originalRequest: 'foo',
      status: 'completed',
      entry: { ts: '2026-04-22T00:00:00.000Z', mode: 'create', request: 'foo', done: true, overall: 90 },
    });
    expect(out.iterations).toHaveLength(1);
    expect(out.status).toBe('completed');
  });

  it('upsert appends on subsequent calls', async () => {
    const dir = join(base, 'p3');
    await mkdir(dir);
    await upsertWorkspaceState(dir, {
      projectId: 'p3',
      recipeType: '2d-game',
      originalRequest: 'first',
      status: 'completed',
      entry: { ts: '2026-04-22T00:00:00.000Z', mode: 'create', request: 'first' },
    });
    const out = await upsertWorkspaceState(dir, {
      projectId: 'p3',
      recipeType: '2d-game',
      originalRequest: 'first',
      status: 'in-progress',
      entry: { ts: '2026-04-22T01:00:00.000Z', mode: 'iterate', request: 'tweak' },
    });
    expect(out.iterations).toHaveLength(2);
    expect(out.status).toBe('in-progress');
  });
});

describe('cli/utils/workspace — listProjects / findProject', () => {
  it('empty workspace returns an empty list', async () => {
    expect(await listProjects(base)).toEqual([]);
  });

  it('returns newest-first, skipping hidden dirs', async () => {
    await mkdir(join(base, '.snapshots'), { recursive: true });
    await mkdir(join(base, 'a'));
    await mkdir(join(base, 'b'));
    await writeWorkspaceState(join(base, 'a'), {
      ...sampleState('a'),
      lastRunAt: '2026-04-22T01:00:00.000Z',
    });
    await writeWorkspaceState(join(base, 'b'), {
      ...sampleState('b'),
      lastRunAt: '2026-04-22T02:00:00.000Z',
    });
    const out = await listProjects(base);
    expect(out.map((p) => p.projectId)).toEqual(['b', 'a']);
  });

  it('findProject throws PROJECT_NOT_FOUND for an unknown id', async () => {
    const err = (await findProject(base, 'nope').catch((e) => e)) as unknown;
    expect(err).toBeInstanceOf(UafError);
    expect((err as UafError).code).toBe('PROJECT_NOT_FOUND');
  });

  it('findProject returns the project when present', async () => {
    await mkdir(join(base, 'ok'));
    const state = sampleState('ok');
    await writeWorkspaceState(join(base, 'ok'), state);
    const p = await findProject(base, 'ok');
    expect(p.projectId).toBe('ok');
    expect(p.state).toEqual(state);
  });
});

describe('cli/utils/workspace — snapshot helpers', () => {
  it('snapshotDir encodes timestamp', () => {
    const d = new Date(Date.UTC(2026, 3, 22, 13, 5, 7));
    const abs = snapshotDir('/base', 'proj-1', d);
    // YYYYMMDDhhmmss — local time; just assert the shape has 14 digits.
    expect(abs).toMatch(/proj-1-\d{14}$/);
  });

  it('listSnapshots returns empty when missing', async () => {
    expect(await listSnapshots(base)).toEqual([]);
  });

  it('listSnapshots parses projectId from dir names', async () => {
    await mkdir(join(base, '.snapshots'), { recursive: true });
    await mkdir(join(base, '.snapshots', 'foo-20260422010203'));
    await mkdir(join(base, '.snapshots', 'bar-baz-20260422050607'));
    const snaps = await listSnapshots(base);
    const byName = Object.fromEntries(snaps.map((s) => [s.name, s.projectId]));
    expect(byName).toMatchObject({
      'foo-20260422010203': 'foo',
      'bar-baz-20260422050607': 'bar-baz',
    });
  });
});
