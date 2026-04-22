/**
 * Phase 11.a.1 regression for core/asset-cache.ts.
 *
 * Locks in:
 *   - stable cache keys (order-insensitive params, prompt whitespace matters)
 *   - get returns null when absent, Buffer+meta when present
 *   - set creates the directory and writes both the file and the .meta.json
 *   - unknown/unsafe extensions are normalized to `bin`
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAssetCache } from '../../core/asset-cache.js';

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'uaf-cache-'));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('core/asset-cache — computeKey', () => {
  const cache = createAssetCache();

  it('is stable across param-key ordering', () => {
    const a = cache.computeKey({
      provider: 'x',
      model: 'y',
      prompt: 'hello',
      params: { width: 64, height: 64, seed: 1 },
    });
    const b = cache.computeKey({
      provider: 'x',
      model: 'y',
      prompt: 'hello',
      params: { seed: 1, height: 64, width: 64 },
    });
    expect(a).toBe(b);
  });

  it('differs on prompt whitespace (strict equality)', () => {
    const a = cache.computeKey({ provider: 'x', model: 'y', prompt: 'hello world', params: {} });
    const b = cache.computeKey({ provider: 'x', model: 'y', prompt: 'hello  world', params: {} });
    expect(a).not.toBe(b);
  });

  it('differs when any field changes', () => {
    const base = { provider: 'x', model: 'y', prompt: 'p', params: { w: 1 } };
    const k = cache.computeKey(base);
    expect(cache.computeKey({ ...base, provider: 'z' })).not.toBe(k);
    expect(cache.computeKey({ ...base, model: 'z' })).not.toBe(k);
    expect(cache.computeKey({ ...base, prompt: 'q' })).not.toBe(k);
    expect(cache.computeKey({ ...base, params: { w: 2 } })).not.toBe(k);
  });

  it('returns a 64-hex-char SHA-256', () => {
    const k = cache.computeKey({ provider: 'x', model: 'y', prompt: 'p', params: {} });
    expect(k).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is insensitive to deeply nested param ordering', () => {
    const a = cache.computeKey({
      provider: 'x',
      model: 'y',
      prompt: 'p',
      params: { nested: { a: 1, b: 2 } },
    });
    const b = cache.computeKey({
      provider: 'x',
      model: 'y',
      prompt: 'p',
      params: { nested: { b: 2, a: 1 } },
    });
    expect(a).toBe(b);
  });
});

describe('core/asset-cache — get / set', () => {
  it('get returns null when the entry is absent', async () => {
    const cache = createAssetCache();
    const hit = await cache.get(tmp, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'png');
    expect(hit).toBeNull();
  });

  it('set then get round-trips bytes and metadata', async () => {
    const cache = createAssetCache();
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const key = cache.computeKey({ provider: 'replicate', model: 'sdxl', prompt: 'a', params: {} });
    await cache.set(tmp, key, 'png', bytes, {
      provider: 'replicate',
      model: 'sdxl',
      prompt: 'a',
      params: {},
      createdAt: '2026-04-22T00:00:00.000Z',
      costUsd: 0.003,
      mimeType: 'image/png',
    });
    const hit = await cache.get(tmp, key, 'png');
    expect(hit).not.toBeNull();
    expect(Array.from(hit!.bytes)).toEqual([1, 2, 3, 4, 5]);
    expect(hit!.metadata.provider).toBe('replicate');
    expect(hit!.metadata.costUsd).toBe(0.003);
  });

  it('resolvePath uses a 2-char prefix directory', () => {
    const cache = createAssetCache();
    const key = 'ab' + '0'.repeat(62);
    const path = cache.resolvePath(tmp, key, 'png');
    expect(path).toContain(`${join('assets', '.cache', 'ab', key)}.png`);
  });

  it('set creates intermediate directories', async () => {
    const cache = createAssetCache();
    const key = 'ff' + '1'.repeat(62);
    await cache.set(tmp, key, 'mp3', new Uint8Array([9, 9]), {
      provider: 'elevenlabs',
      model: 'sfx',
      prompt: 'zap',
      params: { durationSec: 1 },
      createdAt: '2026-04-22T00:00:00.000Z',
      costUsd: 0.00133,
      mimeType: 'audio/mpeg',
    });
    const path = cache.resolvePath(tmp, key, 'mp3');
    await expect(stat(path)).resolves.toBeDefined();
    await expect(readFile(path + '.meta.json', 'utf8')).resolves.toContain('elevenlabs');
  });

  it('missing .meta.json is treated as empty metadata (not fatal)', async () => {
    const cache = createAssetCache();
    const key = 'cc' + '2'.repeat(62);
    // Write the bytes but not the meta sidecar.
    const { mkdir, writeFile } = await import('node:fs/promises');
    const { dirname } = await import('node:path');
    const path = cache.resolvePath(tmp, key, 'png');
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, new Uint8Array([0, 1]));
    const hit = await cache.get(tmp, key, 'png');
    expect(hit).not.toBeNull();
    expect(hit!.metadata).toEqual({});
  });

  it('unsafe extensions are normalized to `bin`', async () => {
    const cache = createAssetCache();
    const key = 'dd' + '3'.repeat(62);
    const pathA = cache.resolvePath(tmp, key, '../evil');
    expect(pathA.endsWith('.bin')).toBe(true);
    const pathB = cache.resolvePath(tmp, key, 'OGG ');
    // Trailing space is treated as unsafe since it doesn't match the pattern.
    expect(pathB.endsWith('.bin') || pathB.endsWith('.ogg')).toBe(true);
  });
});
