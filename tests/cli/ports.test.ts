/**
 * Phase 7.8.6 — port discovery for `uaf preview`.
 *
 * Bind a port deliberately, then check `findFreePort` walks past it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:net';
import { findFreePort, isPortFree } from '../../cli/utils/ports.js';

let blockers: Server[] = [];

beforeEach(() => {
  blockers = [];
});
afterEach(async () => {
  for (const s of blockers) {
    await new Promise<void>((r) => s.close(() => r()));
  }
});

function block(port: number): Promise<Server> {
  return new Promise((resolveFn, rejectFn) => {
    const s = createServer();
    s.once('error', rejectFn);
    s.once('listening', () => {
      blockers.push(s);
      resolveFn(s);
    });
    s.listen(port, '127.0.0.1');
  });
}

describe('isPortFree', () => {
  it('true for an unbound port', async () => {
    expect(await isPortFree(53217)).toBe(true);
  });

  it('false for a port that is already bound', async () => {
    await block(53218);
    expect(await isPortFree(53218)).toBe(false);
  });
});

describe('findFreePort', () => {
  it('returns the preferred port when free', async () => {
    const p = await findFreePort({ preferred: 53301 });
    expect(p).toBe(53301);
  });

  it('walks upward past blocked ports', async () => {
    await block(53401);
    await block(53402);
    const p = await findFreePort({ preferred: 53401 });
    expect(p).toBe(53403);
  });

  it('throws when nothing in range is free', async () => {
    // Tiny window — block both candidates.
    await block(53501);
    await block(53502);
    await expect(findFreePort({ preferred: 53501, max: 2 })).rejects.toThrow(
      /no free port/,
    );
  });
});
