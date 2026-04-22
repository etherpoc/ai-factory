/**
 * Phase 11.a.1 regression for core/asset-generator.ts.
 *
 * Uses in-memory fake providers (not nock) to test the generator's own
 * behavior: cache hit/miss, budget enforcement, file writes, metadata shape,
 * provider selection.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAssetCache } from '../../core/asset-cache.js';
import { createAssetGenerator } from '../../core/asset-generator.js';
import { createAudioProviderRegistry } from '../../core/providers/audio/index.js';
import { createImageProviderRegistry } from '../../core/providers/image/index.js';
import {
  ProviderError,
  type AudioProvider,
  type AudioSpec,
  type ImageProvider,
  type ImageSpec,
} from '../../core/providers/types.js';

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'uaf-gen-'));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

function fakeImageProvider(opts?: { cost?: number; bytes?: Uint8Array; name?: string }): ImageProvider & { calls: number } {
  const self = {
    name: opts?.name ?? 'replicate',
    calls: 0,
    supports: (_s: ImageSpec) => true,
    estimateCost: (_s: ImageSpec) => opts?.cost ?? 0.003,
    async generate(_s: ImageSpec) {
      self.calls += 1;
      return {
        bytes: opts?.bytes ?? new Uint8Array([1, 2, 3]),
        mimeType: 'image/png',
        costUsd: opts?.cost ?? 0.003,
        metadata: { model: 'sdxl-test' },
      };
    },
  };
  return self;
}

function fakeAudioProvider(opts?: { cost?: number; bytes?: Uint8Array }): AudioProvider & { calls: number } {
  const self = {
    name: 'elevenlabs',
    calls: 0,
    supports: (s: AudioSpec) => s.kind !== 'voice',
    estimateCost: (s: AudioSpec) => opts?.cost ?? s.durationSec * 0.00133,
    async generate(s: AudioSpec) {
      self.calls += 1;
      return {
        bytes: opts?.bytes ?? new Uint8Array([0xff, 0xfb]),
        mimeType: 'audio/mpeg',
        costUsd: opts?.cost ?? s.durationSec * 0.00133,
        metadata: { durationSec: s.durationSec },
      };
    },
  };
  return self;
}

function makeGen(
  imageP: (ImageProvider & { calls?: number })[] = [fakeImageProvider()],
  audioP: (AudioProvider & { calls?: number })[] = [fakeAudioProvider()],
  assetBudgetUsd?: number,
) {
  return createAssetGenerator({
    imageProviders: createImageProviderRegistry(imageP),
    audioProviders: createAudioProviderRegistry(audioP),
    cache: createAssetCache(),
    ...(assetBudgetUsd !== undefined ? { assetBudgetUsd } : {}),
  });
}

describe('core/asset-generator — image', () => {
  it('generates on cache miss and writes to assets/images/', async () => {
    const p = fakeImageProvider();
    const gen = makeGen([p]);
    const ref = await gen.generateImage({ prompt: 'blue box', width: 64, height: 64 }, tmp);
    expect(ref.cached).toBe(false);
    expect(ref.costUsd).toBeGreaterThan(0);
    expect(ref.provider).toBe('replicate');
    expect(ref.relPath.startsWith('assets' + require('node:path').sep + 'images')).toBe(true);
    // file must exist and match
    const disk = await readFile(ref.path);
    expect(Array.from(disk)).toEqual([1, 2, 3]);
    expect(p.calls).toBe(1);
  });

  it('returns cached=true and cost=0 on the second identical call', async () => {
    const p = fakeImageProvider();
    const gen = makeGen([p]);
    const spec: ImageSpec = { prompt: 'same', width: 64, height: 64 };
    const a = await gen.generateImage(spec, tmp);
    const b = await gen.generateImage(spec, tmp);
    expect(a.cached).toBe(false);
    expect(b.cached).toBe(true);
    expect(b.costUsd).toBe(0);
    expect(p.calls).toBe(1); // provider called once total
    expect(b.cacheKey).toBe(a.cacheKey);
  });

  it('different prompts = different cache keys', async () => {
    const p = fakeImageProvider();
    const gen = makeGen([p]);
    await gen.generateImage({ prompt: 'x', width: 64, height: 64 }, tmp);
    await gen.generateImage({ prompt: 'y', width: 64, height: 64 }, tmp);
    expect(p.calls).toBe(2);
  });

  it('picks provider by name when spec.provider is explicit', async () => {
    const a = fakeImageProvider({ name: 'provA' });
    const b = fakeImageProvider({ name: 'provB' });
    const gen = makeGen([a, b]);
    await gen.generateImage({ prompt: 'x', width: 64, height: 64, provider: 'provB' }, tmp);
    expect(a.calls).toBe(0);
    expect(b.calls).toBe(1);
  });

  it('throws PROVIDER_NOT_FOUND when a missing provider is requested', async () => {
    const gen = makeGen();
    const err = (await gen
      .generateImage({ prompt: 'x', width: 64, height: 64, provider: 'does-not-exist' }, tmp)
      .catch((e) => e)) as unknown;
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).code).toBe('PROVIDER_NOT_FOUND');
  });

  it('throws NO_PROVIDERS when registry is empty', async () => {
    const gen = makeGen([], [fakeAudioProvider()]);
    const err = (await gen
      .generateImage({ prompt: 'x', width: 64, height: 64 }, tmp)
      .catch((e) => e)) as unknown;
    expect((err as ProviderError).code).toBe('NO_PROVIDERS');
  });
});

describe('core/asset-generator — audio', () => {
  it('generates SFX and reports cached=false', async () => {
    const p = fakeAudioProvider();
    const gen = makeGen(undefined, [p]);
    const ref = await gen.generateAudio({ kind: 'sfx', prompt: 'zap', durationSec: 1 }, tmp);
    expect(ref.cached).toBe(false);
    expect(ref.costUsd).toBeGreaterThan(0);
    expect(ref.relPath.startsWith('assets' + require('node:path').sep + 'audio')).toBe(true);
  });

  it('caches BGM across calls', async () => {
    const p = fakeAudioProvider();
    const gen = makeGen(undefined, [p]);
    const spec: AudioSpec = { kind: 'bgm', prompt: 'loop', durationSec: 10 };
    await gen.generateAudio(spec, tmp);
    const b = await gen.generateAudio(spec, tmp);
    expect(b.cached).toBe(true);
    expect(p.calls).toBe(1);
  });
});

describe('core/asset-generator — budget', () => {
  it('throws ASSET_BUDGET_EXCEEDED when the next image would overrun', async () => {
    const p = fakeImageProvider({ cost: 0.5 });
    const gen = makeGen([p], undefined, 0.7);
    await gen.generateImage({ prompt: 'a', width: 64, height: 64 }, tmp); // 0.5 spent
    const err = (await gen
      .generateImage({ prompt: 'b', width: 64, height: 64 }, tmp) // would make 1.0
      .catch((e) => e)) as unknown;
    expect((err as ProviderError).code).toBe('ASSET_BUDGET_EXCEEDED');
    expect(gen.spentUsd).toBeCloseTo(0.5, 5);
  });

  it('cache hits do not consume budget', async () => {
    const p = fakeImageProvider({ cost: 0.3 });
    const gen = makeGen([p], undefined, 0.35);
    const spec: ImageSpec = { prompt: 'same', width: 64, height: 64 };
    await gen.generateImage(spec, tmp);
    // Second call is a cache hit — no budget consumed.
    const b = await gen.generateImage(spec, tmp);
    expect(b.cached).toBe(true);
    expect(gen.spentUsd).toBeCloseTo(0.3, 5);
  });
});

describe('core/asset-generator — introspection', () => {
  it('providerNames reports both registries', () => {
    const gen = makeGen([fakeImageProvider({ name: 'rep' })], [fakeAudioProvider()]);
    expect(gen.providerNames()).toEqual({ image: ['rep'], audio: ['elevenlabs'] });
  });

  it('estimateCost delegates to the picked provider', () => {
    const p = fakeImageProvider({ cost: 0.42 });
    const gen = makeGen([p]);
    expect(gen.estimateCost({ prompt: 'x', width: 64, height: 64 })).toBe(0.42);
  });
});
