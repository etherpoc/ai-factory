/**
 * Phase 7.8.6 — `uaf preview --stop` and `--stop-all` clear state.preview.
 *
 * Spinning up real dev servers in CI would be slow and flaky, so these tests
 * stub the running process by recording a long-lived child (a Node sleep
 * loop) and asserting --stop kills it AND clears state.json.preview.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readWorkspaceState,
  writeWorkspaceState,
  type WorkspaceState,
} from '../../core/state.js';

let base: string;
let prevCwd: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'uaf-preview-'));
  await mkdir(join(base, 'workspace'));
  prevCwd = process.cwd();
  process.chdir(base);
});
afterEach(async () => {
  process.chdir(prevCwd);
  await rm(base, { recursive: true, force: true });
});

function withRunningChild(): { pid: number; cleanup: () => void } {
  // A long-running Node child we can SIGTERM. Use `setInterval` so it stays alive.
  const child = spawn(
    process.execPath,
    ['-e', 'setInterval(()=>{},1<<30)'],
    { stdio: 'ignore', detached: true },
  );
  child.unref();
  return {
    pid: child.pid!,
    cleanup: () => {
      try {
        process.kill(child.pid!);
      } catch {
        /* ignore */
      }
    },
  };
}

function withState(_projDir: string, pid: number): WorkspaceState {
  return {
    projectId: 'p1',
    recipeType: '2d-game',
    originalRequest: 'foo',
    createdAt: '2026-04-23T00:00:00.000Z',
    lastRunAt: '2026-04-23T00:00:00.000Z',
    status: 'completed',
    iterations: [],
    preview: {
      pid,
      port: 5173,
      url: 'http://localhost:5173/',
      startedAt: '2026-04-23T00:00:00.000Z',
      detached: true,
      command: 'pnpm dev',
    },
  } satisfies WorkspaceState & { preview: NonNullable<WorkspaceState['preview']> };
}

describe('uaf preview --stop', () => {
  it('kills the recorded pid and clears state.preview', async () => {
    const projDir = join(base, 'workspace', 'p1');
    await mkdir(projDir);
    const proc = withRunningChild();
    try {
      await writeWorkspaceState(projDir, withState(projDir, proc.pid));
      const { runPreview } = await import('../../cli/commands/preview.js');
      // Suppress noise.
      const origErr = process.stderr.write.bind(process.stderr);
      process.stderr.write = (() => true) as typeof process.stderr.write;
      try {
        await runPreview({ projectId: 'p1', stop: true });
      } finally {
        process.stderr.write = origErr;
      }
      const after = await readWorkspaceState(projDir);
      expect(after?.preview).toBeUndefined();
      // Process should be gone within ~100ms.
      await new Promise((r) => setTimeout(r, 100));
      let alive = true;
      try {
        process.kill(proc.pid, 0);
      } catch {
        alive = false;
      }
      expect(alive).toBe(false);
    } finally {
      proc.cleanup();
    }
  });

  it('clears state even when the recorded pid is already dead', async () => {
    const projDir = join(base, 'workspace', 'p2');
    await mkdir(projDir);
    // 0xFFFF likely unused; if it's alive on the runner the test still passes
    // because we just verify the state field gets cleared.
    const fakePid = 999_999;
    await writeWorkspaceState(projDir, {
      ...withState(projDir, fakePid),
      projectId: 'p2',
    });
    const { runPreview } = await import('../../cli/commands/preview.js');
    const origErr = process.stderr.write.bind(process.stderr);
    process.stderr.write = (() => true) as typeof process.stderr.write;
    try {
      await runPreview({ projectId: 'p2', stop: true });
    } finally {
      process.stderr.write = origErr;
    }
    const after = await readWorkspaceState(projDir);
    expect(after?.preview).toBeUndefined();
  });

  it('--stop on a project with no recorded preview is a no-op', async () => {
    const projDir = join(base, 'workspace', 'p3');
    await mkdir(projDir);
    await writeWorkspaceState(projDir, {
      projectId: 'p3',
      recipeType: '2d-game',
      originalRequest: 'x',
      createdAt: '2026-04-23T00:00:00.000Z',
      lastRunAt: '2026-04-23T00:00:00.000Z',
      status: 'completed',
      iterations: [],
    });
    const { runPreview } = await import('../../cli/commands/preview.js');
    const origErr = process.stderr.write.bind(process.stderr);
    process.stderr.write = (() => true) as typeof process.stderr.write;
    try {
      await runPreview({ projectId: 'p3', stop: true });
    } finally {
      process.stderr.write = origErr;
    }
    // Still no preview field — and no throw.
    const after = await readWorkspaceState(projDir);
    expect(after?.preview).toBeUndefined();
  });
});

describe('uaf preview --stop-all', () => {
  it('iterates across projects and clears every preview', async () => {
    for (const id of ['a', 'b']) {
      const projDir = join(base, 'workspace', id);
      await mkdir(projDir);
      const proc = withRunningChild();
      // Don't bother killing: the preview --stop-all path will do it.
      void proc;
      await writeWorkspaceState(projDir, {
        ...withState(projDir, proc.pid),
        projectId: id,
      });
    }
    const { runPreview } = await import('../../cli/commands/preview.js');
    const origErr = process.stderr.write.bind(process.stderr);
    process.stderr.write = (() => true) as typeof process.stderr.write;
    try {
      await runPreview({ stopAll: true });
    } finally {
      process.stderr.write = origErr;
    }
    for (const id of ['a', 'b']) {
      const after = await readWorkspaceState(join(base, 'workspace', id));
      expect(after?.preview).toBeUndefined();
    }
  });
});
