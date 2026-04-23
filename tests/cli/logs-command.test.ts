/**
 * Phase 7.8.10 — `uaf logs` command tests.
 *
 * Uses a temp workspace with a hand-written `workspace/<pid>/logs/create.log`
 * (one JSON line per event) + a minimal state.json so `findProject` succeeds.
 * Captures stdout and asserts on the rendered output.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runLogs } from '../../cli/commands/logs.js';
import { UafError } from '../../cli/ui/errors.js';

let tmpRoot: string;
let projectId: string;
let prevCwd: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'uaf-logs-'));
  projectId = 'demo-proj';
  // No .uafrc — the default `./workspace` path is what we want.
  await mkdir(join(tmpRoot, 'workspace', projectId, 'logs'), { recursive: true });
  await writeFile(
    join(tmpRoot, 'workspace', projectId, 'state.json'),
    JSON.stringify({
      projectId,
      recipeType: '2d-game',
      originalRequest: 'hello',
      status: 'in-progress',
      lastRunAt: new Date().toISOString(),
      iterations: [],
    }),
    'utf8',
  );
  prevCwd = process.cwd();
  process.chdir(tmpRoot);
});

afterEach(async () => {
  process.chdir(prevCwd);
  await rm(tmpRoot, { recursive: true, force: true });
});

/** Build a pino-style JSON line. */
function jline(msg: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    time: Date.parse('2026-04-23T10:00:00Z'),
    level: 30,
    name: 'uaf.create',
    msg,
    ...extra,
  });
}

describe('uaf logs', () => {
  it('renders pretty output by default and contains message text', async () => {
    const log = join(tmpRoot, 'workspace', projectId, 'logs', 'create.log');
    await writeFile(log, [jline('first event'), jline('second event', { role: 'director' })].join('\n') + '\n', 'utf8');

    const chunks: string[] = [];
    const spy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((s: string | Uint8Array) => {
        chunks.push(typeof s === 'string' ? s : Buffer.from(s).toString('utf8'));
        return true;
      });
    try {
      await runLogs({ projectId });
    } finally {
      spy.mockRestore();
    }
    const out = chunks.join('');
    expect(out).toContain('first event');
    expect(out).toContain('second event');
    expect(out).toContain('director'); // extras rendered
  });

  it('--raw bypasses prettification', async () => {
    const log = join(tmpRoot, 'workspace', projectId, 'logs', 'create.log');
    const line = jline('raw event', { k: 1 });
    await writeFile(log, line + '\n', 'utf8');

    const chunks: string[] = [];
    const spy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((s: string | Uint8Array) => {
        chunks.push(typeof s === 'string' ? s : Buffer.from(s).toString('utf8'));
        return true;
      });
    try {
      await runLogs({ projectId, raw: true });
    } finally {
      spy.mockRestore();
    }
    expect(chunks.join('')).toContain(line);
  });

  it('--filter keeps only matching lines (case-insensitive)', async () => {
    const log = join(tmpRoot, 'workspace', projectId, 'logs', 'create.log');
    const a = jline('ERR boom', { level: 50 });
    const b = jline('info ok');
    const c = jline('another error here', { level: 50 });
    await writeFile(log, [a, b, c].join('\n') + '\n', 'utf8');

    const chunks: string[] = [];
    const spy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((s: string | Uint8Array) => {
        chunks.push(typeof s === 'string' ? s : Buffer.from(s).toString('utf8'));
        return true;
      });
    try {
      await runLogs({ projectId, filter: 'error', raw: true });
    } finally {
      spy.mockRestore();
    }
    const out = chunks.join('');
    expect(out).toContain('another error here');
    // "ERR boom" matches "error" case-insensitively? No — "err" is contained
    // in "error" but the filter is "error" and that substring is NOT in "err boom".
    // Only c is kept.
    expect(out).not.toContain('ERR boom');
    expect(out).not.toContain('info ok');
  });

  it('--tail 1 keeps only the last line', async () => {
    const log = join(tmpRoot, 'workspace', projectId, 'logs', 'create.log');
    const a = jline('line one');
    const b = jline('line two');
    await writeFile(log, [a, b].join('\n') + '\n', 'utf8');

    const chunks: string[] = [];
    const spy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((s: string | Uint8Array) => {
        chunks.push(typeof s === 'string' ? s : Buffer.from(s).toString('utf8'));
        return true;
      });
    try {
      await runLogs({ projectId, tail: '1', raw: true });
    } finally {
      spy.mockRestore();
    }
    const out = chunks.join('');
    expect(out).toContain(b);
    expect(out).not.toContain(a);
  });

  it('missing logs dir throws PROJECT_NOT_FOUND with a helpful hint', async () => {
    await rm(join(tmpRoot, 'workspace', projectId, 'logs'), { recursive: true });
    const promise = runLogs({ projectId });
    await expect(promise).rejects.toBeInstanceOf(UafError);
    await expect(promise).rejects.toMatchObject({ code: 'PROJECT_NOT_FOUND' });
  });

  it('--cmd <name> picks a specific log file', async () => {
    const logs = join(tmpRoot, 'workspace', projectId, 'logs');
    await writeFile(join(logs, 'create.log'), jline('from create') + '\n', 'utf8');
    await writeFile(join(logs, 'resume.log'), jline('from resume') + '\n', 'utf8');

    const chunks: string[] = [];
    const spy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((s: string | Uint8Array) => {
        chunks.push(typeof s === 'string' ? s : Buffer.from(s).toString('utf8'));
        return true;
      });
    try {
      await runLogs({ projectId, cmd: 'resume', raw: true });
    } finally {
      spy.mockRestore();
    }
    const out = chunks.join('');
    expect(out).toContain('from resume');
    expect(out).not.toContain('from create');
  });
});
