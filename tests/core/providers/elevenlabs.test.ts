/**
 * Phase 11.a.1 regression for core/providers/audio/elevenlabs.ts.
 *
 * Verifies:
 *   - POST /v1/sound-generation gets called with correct headers + body
 *   - sfx and bgm prompts are both supported (voice is rejected)
 *   - mp3 bytes come back intact
 *   - 401 → UNAUTHORIZED, 429 → RATE_LIMIT, 500 → REQUEST_FAILED
 *   - empty body → EMPTY_BODY
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import nock from 'nock';
import { ProviderError } from '../../../core/providers/types.js';
import { createElevenLabsProvider } from '../../../core/providers/audio/elevenlabs.js';

const BASE = 'https://api.elevenlabs.io';

beforeEach(() => nock.disableNetConnect());
afterEach(() => {
  nock.cleanAll();
  nock.enableNetConnect();
});

function provider(opts?: { timeoutMs?: number }) {
  return createElevenLabsProvider({
    apiKey: 'test-key',
    timeoutMs: opts?.timeoutMs ?? 5_000,
    concurrency: 4,
    fetchImpl: fetch,
  });
}

describe('core/providers/audio/elevenlabs', () => {
  it('rejects an empty API key at construction', () => {
    expect(() => createElevenLabsProvider({ apiKey: '', fetchImpl: fetch })).toThrow(ProviderError);
  });

  it('supports sfx and bgm but not voice', () => {
    const p = provider();
    expect(p.supports({ kind: 'sfx', prompt: 'x', durationSec: 1 })).toBe(true);
    expect(p.supports({ kind: 'bgm', prompt: 'x', durationSec: 10 })).toBe(true);
    expect(p.supports({ kind: 'voice', prompt: 'x', durationSec: 1 })).toBe(false);
  });

  it('throws UNSUPPORTED_KIND when asked to generate a voice clip', async () => {
    const err = (await provider()
      .generate({ kind: 'voice', prompt: 'hello', durationSec: 1 })
      .catch((e) => e)) as unknown;
    expect((err as ProviderError).code).toBe('UNSUPPORTED_KIND');
  });

  it('estimateCost clamps to the 22-second API cap', () => {
    const p = provider();
    const hi = p.estimateCost({ kind: 'bgm', prompt: 'x', durationSec: 60 });
    const lo = p.estimateCost({ kind: 'bgm', prompt: 'x', durationSec: 22 });
    expect(hi).toBe(lo); // longer spec still billed at the 22s cap
    expect(hi).toBeGreaterThan(0);
  });

  it('happy path: returns mp3 bytes with cost > 0', async () => {
    const mp3Bytes = Buffer.from([0xff, 0xfb, 0x90, 0x64]); // MP3 frame header
    nock(BASE)
      .post('/v1/sound-generation')
      .matchHeader('xi-api-key', 'test-key')
      .reply(200, mp3Bytes, { 'content-type': 'audio/mpeg' });

    const out = await provider().generate({ kind: 'sfx', prompt: 'blip', durationSec: 1 });
    expect(out.mimeType).toContain('audio/mpeg');
    expect(Array.from(out.bytes.slice(0, 4))).toEqual([0xff, 0xfb, 0x90, 0x64]);
    expect(out.costUsd).toBeGreaterThan(0);
    expect(out.metadata.kind).toBe('sfx');
  });

  it('BGM prompt is framed with a music-loop prefix', async () => {
    let capturedBody: unknown;
    nock(BASE)
      .post('/v1/sound-generation')
      .reply(200, (_uri, body) => {
        capturedBody = body;
        return Buffer.from([0xff]);
      }, { 'content-type': 'audio/mpeg' });

    await provider().generate({ kind: 'bgm', prompt: 'tense synthwave', durationSec: 10 });
    expect((capturedBody as { text: string }).text).toContain('background music loop');
    expect((capturedBody as { duration_seconds: number }).duration_seconds).toBe(10);
  });

  it('401 → UNAUTHORIZED', async () => {
    nock(BASE).post('/v1/sound-generation').reply(401, { detail: 'bad key' });
    const err = (await provider()
      .generate({ kind: 'sfx', prompt: 'x', durationSec: 1 })
      .catch((e) => e)) as unknown;
    expect((err as ProviderError).code).toBe('UNAUTHORIZED');
    expect((err as ProviderError).retryable).toBe(false);
  });

  it('429 → RATE_LIMIT (retryable)', async () => {
    nock(BASE).post('/v1/sound-generation').reply(429, 'slow');
    const err = (await provider()
      .generate({ kind: 'sfx', prompt: 'x', durationSec: 1 })
      .catch((e) => e)) as unknown;
    expect((err as ProviderError).code).toBe('RATE_LIMIT');
    expect((err as ProviderError).retryable).toBe(true);
  });

  it('500 → REQUEST_FAILED (retryable)', async () => {
    nock(BASE).post('/v1/sound-generation').reply(500, 'internal');
    const err = (await provider()
      .generate({ kind: 'sfx', prompt: 'x', durationSec: 1 })
      .catch((e) => e)) as unknown;
    expect((err as ProviderError).code).toBe('REQUEST_FAILED');
    expect((err as ProviderError).retryable).toBe(true);
  });

  it('empty body → EMPTY_BODY', async () => {
    nock(BASE).post('/v1/sound-generation').reply(200, Buffer.alloc(0), {
      'content-type': 'audio/mpeg',
    });
    const err = (await provider()
      .generate({ kind: 'sfx', prompt: 'x', durationSec: 1 })
      .catch((e) => e)) as unknown;
    expect((err as ProviderError).code).toBe('EMPTY_BODY');
  });
});
