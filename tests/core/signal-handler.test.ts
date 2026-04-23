/**
 * Phase 7.8.1 — SIGINT handler.
 *
 * The handler is a process-level singleton, so we mostly test it via the
 * exported registry helpers and a direct call to the would-be SIGINT path.
 * A real SIGINT test would terminate the test runner, which we don't want.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeWorkspaceState, type WorkspaceState } from '../../core/state.js';
import {
  __resetSigintHandlerForTests,
  clearActiveProject,
  getActiveProject,
  installSigintHandler,
  setActiveProject,
} from '../../core/signal-handler.js';

let proj: string;
beforeEach(async () => {
  __resetSigintHandlerForTests();
  const base = await mkdtemp(join(tmpdir(), 'uaf-sig-'));
  proj = join(base, 'p1');
  await mkdir(proj);
});
afterEach(async () => {
  __resetSigintHandlerForTests();
  await rm(proj, { recursive: true, force: true }).catch(() => undefined);
  // Tear down our test SIGINT listener so it doesn't leak across tests.
  process.removeAllListeners('SIGINT');
});

describe('signal-handler — registry', () => {
  it('set / get / clear active project', () => {
    expect(getActiveProject()).toBeNull();
    setActiveProject({ projectId: 'p1', workspaceDir: proj });
    expect(getActiveProject()).toEqual({ projectId: 'p1', workspaceDir: proj });
    clearActiveProject();
    expect(getActiveProject()).toBeNull();
  });

  it('installSigintHandler is idempotent', () => {
    const before = process.listenerCount('SIGINT');
    installSigintHandler({ exit: () => undefined });
    installSigintHandler({ exit: () => undefined });
    installSigintHandler({ exit: () => undefined });
    expect(process.listenerCount('SIGINT') - before).toBe(1);
  });
});

describe('signal-handler — SIGINT firing', () => {
  function withState(): WorkspaceState {
    return {
      projectId: 'p1',
      recipeType: '2d-game',
      originalRequest: 'r',
      createdAt: '2026-04-22T00:00:00.000Z',
      lastRunAt: '2026-04-22T00:00:00.000Z',
      status: 'in-progress',
      iterations: [],
      phase: 'build',
      resumable: true,
      roadmap: {
        path: 'roadmap.md',
        createdAt: '2026-04-22T00:00:00.000Z',
        totalTasks: 1,
        completedTasks: 0,
        currentTaskId: 't1',
        tasks: [{ id: 't1', title: 'one', status: 'in-progress' }],
      },
    };
  }

  it('writes interrupt checkpoint on first SIGINT, exits with 130', async () => {
    await writeWorkspaceState(proj, withState());
    const exit = vi.fn();
    const writes: string[] = [];
    const out = { write: (s: string) => writes.push(s) } as unknown as NodeJS.WriteStream;

    installSigintHandler({ out, exit });
    setActiveProject({ projectId: 'p1', workspaceDir: proj });

    process.emit('SIGINT');
    // SIGINT handler kicks off async checkpoint write.
    await new Promise((r) => setTimeout(r, 50));

    expect(exit).toHaveBeenCalledWith(130);
    const { readWorkspaceState } = await import('../../core/state.js');
    const after = await readWorkspaceState(proj);
    expect(after?.phase).toBe('interrupted');
    expect(after?.status).toBe('interrupted');
    expect(writes.some((s) => s.includes('uaf resume p1'))).toBe(true);
  });

  it('exits immediately on a second SIGINT within the cooldown window', async () => {
    await writeWorkspaceState(proj, withState());
    const exit = vi.fn();
    const out = { write: () => undefined } as unknown as NodeJS.WriteStream;

    installSigintHandler({ out, exit });
    setActiveProject({ projectId: 'p1', workspaceDir: proj });

    process.emit('SIGINT');
    process.emit('SIGINT');
    await new Promise((r) => setTimeout(r, 30));

    // First call schedules an async checkpoint then exit; second call exits
    // immediately. So we expect at least 2 calls — the immediate one and the
    // async one (both with code 130).
    expect(exit).toHaveBeenCalledWith(130);
    expect(exit.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('exits with 130 when no active project is registered', async () => {
    const exit = vi.fn();
    const out = { write: () => undefined } as unknown as NodeJS.WriteStream;
    installSigintHandler({ out, exit });

    process.emit('SIGINT');
    await new Promise((r) => setTimeout(r, 10));

    expect(exit).toHaveBeenCalledWith(130);
  });
});
