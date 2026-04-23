/**
 * Phase 7.8.1 — atomic-write smoke + concurrency.
 *
 * R12 (常時再開可能原則): the orchestrator writes state.json on every task
 * checkpoint. A torn write would corrupt the resume path. These tests exist
 * to make sure that — at minimum — readers see either the old or the new
 * file, never a partial one, even under concurrent writers.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomicWrite } from '../../core/utils/atomic-write.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'uaf-aw-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('core/utils/atomic-write', () => {
  it('writes new files', async () => {
    const path = join(dir, 'state.json');
    await atomicWrite(path, '{"hello":"world"}');
    expect(await readFile(path, 'utf8')).toBe('{"hello":"world"}');
  });

  it('overwrites existing files atomically', async () => {
    const path = join(dir, 'state.json');
    await writeFile(path, 'OLD', 'utf8');
    await atomicWrite(path, 'NEW');
    expect(await readFile(path, 'utf8')).toBe('NEW');
  });

  it('cleans up temp file on success (no orphans)', async () => {
    const path = join(dir, 'state.json');
    await atomicWrite(path, 'x');
    const { readdir } = await import('node:fs/promises');
    const entries = await readdir(dir);
    expect(entries.filter((n) => n.startsWith('.state.json.tmp-'))).toHaveLength(0);
  });

  it('cleans up temp file on rename failure', async () => {
    // Force a rename failure by passing an invalid destination (parent dir
    // does not exist). atomicWrite should reject AND not leave a temp behind.
    const bogus = join(dir, 'missing-subdir', 'state.json');
    await expect(atomicWrite(bogus, 'x')).rejects.toThrow();
    const { readdir } = await import('node:fs/promises');
    const entries = await readdir(dir);
    expect(entries).toEqual([]); // nothing left behind
  });

  it('concurrent writes leave a fully-formed file (last writer wins)', async () => {
    const path = join(dir, 'state.json');
    const N = 50;
    const payloads = Array.from({ length: N }, (_, i) => `payload-${i}`);
    await Promise.all(payloads.map((p) => atomicWrite(path, p)));
    const final = await readFile(path, 'utf8');
    expect(payloads).toContain(final); // exactly one of the writes won, intact
  });

  it('handles binary input (Uint8Array)', async () => {
    const path = join(dir, 'blob.bin');
    const buf = new Uint8Array([0, 1, 2, 3, 255]);
    await atomicWrite(path, buf);
    const got = await readFile(path);
    expect(Array.from(got)).toEqual([0, 1, 2, 3, 255]);
  });
});
