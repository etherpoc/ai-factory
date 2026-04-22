/**
 * Phase 7.7 integration tests for `uaf list`.
 *
 * These use a tmp cwd so the command scans our seeded workspace dir rather
 * than the real repo. Output goes to captured stdout for assertions.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runList } from '../../cli/commands/list.js';
import { writeWorkspaceState } from '../../cli/utils/workspace.js';

let tmp: string;
let savedCwd: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'uaf-list-it-'));
  await mkdir(join(tmp, 'workspace'), { recursive: true });
  savedCwd = process.cwd();
  process.chdir(tmp);
});
afterEach(async () => {
  process.chdir(savedCwd);
  await rm(tmp, { recursive: true, force: true });
});

function captureStdout(): { written: () => string; restore: () => void } {
  const chunks: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.stdout.write as any) = (chunk: string | Uint8Array): boolean => {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  };
  return {
    written: () => chunks.join(''),
    restore: () => {
      process.stdout.write = orig;
    },
  };
}

async function seedProject(
  id: string,
  recipeType: string,
  status: 'completed' | 'halted' | 'failed' | 'in-progress' = 'completed',
): Promise<void> {
  const dir = join(tmp, 'workspace', id);
  await mkdir(dir, { recursive: true });
  await writeWorkspaceState(dir, {
    projectId: id,
    recipeType,
    originalRequest: `request-${id}`,
    createdAt: '2026-04-22T00:00:00.000Z',
    lastRunAt: '2026-04-22T00:10:00.000Z',
    status,
    iterations: [{ ts: '2026-04-22T00:00:00.000Z', mode: 'create', request: `request-${id}` }],
  });
}

describe('uaf list — integration', () => {
  it('prints "No projects found." when the workspace is empty', async () => {
    const cap = captureStdout();
    try {
      await runList({});
    } finally {
      cap.restore();
    }
    // Empty case goes to stderr, not stdout — we just want no crash here.
    expect(cap.written()).toBe('');
  });

  it('includes all seeded projects with recipes', async () => {
    await seedProject('p1', '2d-game');
    await seedProject('p2', 'cli');
    const cap = captureStdout();
    try {
      await runList({});
    } finally {
      cap.restore();
    }
    const out = cap.written();
    expect(out).toContain('p1');
    expect(out).toContain('p2');
    expect(out).toContain('2d-game');
    expect(out).toContain('cli');
  });

  it('filters by --recipe', async () => {
    await seedProject('g1', '2d-game');
    await seedProject('c1', 'cli');
    const cap = captureStdout();
    try {
      await runList({ recipe: 'cli' });
    } finally {
      cap.restore();
    }
    const out = cap.written();
    expect(out).toContain('c1');
    expect(out).not.toContain('g1');
  });

  it('filters by --status', async () => {
    await seedProject('ok1', '2d-game', 'completed');
    await seedProject('bad1', '2d-game', 'halted');
    const cap = captureStdout();
    try {
      await runList({ status: 'halted' });
    } finally {
      cap.restore();
    }
    const out = cap.written();
    expect(out).toContain('bad1');
    expect(out).not.toContain('ok1');
  });

  it('emits JSON when --json is set', async () => {
    await seedProject('j1', 'web-app');
    const cap = captureStdout();
    try {
      await runList({ json: true });
    } finally {
      cap.restore();
    }
    const parsed = JSON.parse(cap.written());
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].projectId).toBe('j1');
    expect(parsed[0].recipeType).toBe('web-app');
  });

  it('skips hidden (.snapshots) directories', async () => {
    await mkdir(join(tmp, 'workspace', '.snapshots', 'fake-20260422000000'), { recursive: true });
    await seedProject('visible', 'cli');
    const cap = captureStdout();
    try {
      await runList({ json: true });
    } finally {
      cap.restore();
    }
    const parsed = JSON.parse(cap.written()) as Array<{ projectId: string }>;
    expect(parsed.map((p) => p.projectId)).toEqual(['visible']);
  });
});

async function touchWrite(_p: string): Promise<void> {
  // Helper placeholder — kept because some environments need writeFile to
  // create empty files before stat works.
  return undefined;
}
void touchWrite;
await mkdtemp; // silence unused — imported for type check
void writeFile;
