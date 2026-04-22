/**
 * Phase 11.a.1 regression for core/providers/image/replicate.ts.
 *
 * Mocks the Replicate REST API with nock and verifies the three-step flow:
 *   1. POST /v1/models/<slug>/predictions  → { id, status: "starting" }
 *   2. GET  /v1/predictions/<id>           → polls until "succeeded"
 *   3. GET  <output url>                   → download bytes
 *
 * Also covers error paths (429, 500, failed status, empty output).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import nock from 'nock';
import { ProviderError } from '../../../core/providers/types.js';
import { createReplicateProvider } from '../../../core/providers/image/replicate.js';

const BASE = 'https://api.replicate.com';
const CDN = 'https://replicate.delivery';

beforeEach(() => {
  nock.disableNetConnect();
});
afterEach(() => {
  nock.cleanAll();
  nock.enableNetConnect();
});

function provider(opts?: { timeoutMs?: number }) {
  return createReplicateProvider({
    apiToken: 'test-token',
    timeoutMs: opts?.timeoutMs ?? 5_000,
    concurrency: 4,
    fetchImpl: fetch,
  });
}

describe('core/providers/image/replicate', () => {
  it('rejects an empty API token at construction', () => {
    expect(() =>
      createReplicateProvider({ apiToken: '', fetchImpl: fetch }),
    ).toThrow(ProviderError);
  });

  it('supports every spec (SDXL is general-purpose)', () => {
    const p = provider();
    expect(p.supports({ prompt: 'x', width: 64, height: 64 })).toBe(true);
  });

  it('estimateCost returns a small positive USD figure', () => {
    const p = provider();
    const c = p.estimateCost({ prompt: 'x', width: 1024, height: 1024 });
    expect(c).toBeGreaterThan(0);
    expect(c).toBeLessThan(0.1);
  });

  it('happy path: create → poll → download → bytes', async () => {
    const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);

    nock(BASE)
      .post('/v1/models/black-forest-labs/flux-schnell/predictions')
      .reply(201, {
        id: 'pred-1',
        status: 'starting',
      });

    nock(BASE)
      .get('/v1/predictions/pred-1')
      .reply(200, {
        id: 'pred-1',
        status: 'succeeded',
        output: ['https://replicate.delivery/pbxt/xxx/out.png'],
      });

    nock(CDN).get('/pbxt/xxx/out.png').reply(200, Buffer.from(pngBytes));

    const out = await provider().generate({ prompt: 'a blue square', width: 512, height: 512 });
    expect(out.mimeType).toBe('image/png');
    expect(Array.from(out.bytes.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(out.costUsd).toBeGreaterThan(0);
    expect(out.metadata.predictionId).toBe('pred-1');
    expect(out.metadata.model).toBe('black-forest-labs/flux-schnell');
  });

  it('sends auth header and input body', async () => {
    let capturedAuth: string | undefined;
    let capturedBody: unknown;

    nock(BASE)
      .post('/v1/models/black-forest-labs/flux-schnell/predictions')
      .matchHeader('authorization', (val) => {
        capturedAuth = val;
        return true;
      })
      .reply(201, (_uri, requestBody) => {
        capturedBody = requestBody;
        return { id: 'pred-2', status: 'starting' };
      });
    nock(BASE)
      .get('/v1/predictions/pred-2')
      .reply(200, {
        id: 'pred-2',
        status: 'succeeded',
        output: ['https://replicate.delivery/pbxt/x/y.png'],
      });
    nock(CDN).get('/pbxt/x/y.png').reply(200, Buffer.from([0]));

    await provider().generate({
      prompt: 'a pixel-art ship',
      width: 512,
      height: 512,
      negativePrompt: 'blurry',
      seed: 42,
    });

    expect(capturedAuth).toBe('Bearer test-token');
    // Flux uses aspect_ratio (not width/height) and ignores negative_prompt.
    // `prompt` + `seed` always flow through.
    expect(capturedBody).toMatchObject({
      input: {
        prompt: 'a pixel-art ship',
        aspect_ratio: '1:1',
        seed: 42,
      },
    });
  });

  it('throws RATE_LIMIT on 429', async () => {
    nock(BASE).post('/v1/models/black-forest-labs/flux-schnell/predictions').reply(429, { detail: 'slow down' });
    const err = (await provider().generate({ prompt: 'x', width: 64, height: 64 }).catch((e) => e)) as unknown;
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).code).toBe('RATE_LIMIT');
    expect((err as ProviderError).retryable).toBe(true);
  });

  it('throws CREATE_FAILED on 500', async () => {
    nock(BASE).post('/v1/models/black-forest-labs/flux-schnell/predictions').reply(500, 'boom');
    const err = (await provider().generate({ prompt: 'x', width: 64, height: 64 }).catch((e) => e)) as unknown;
    expect((err as ProviderError).code).toBe('CREATE_FAILED');
    expect((err as ProviderError).retryable).toBe(true);
  });

  it('throws GENERATION_FAILED when the prediction reports failed', async () => {
    nock(BASE)
      .post('/v1/models/black-forest-labs/flux-schnell/predictions')
      .reply(201, { id: 'p3', status: 'starting' });
    nock(BASE)
      .get('/v1/predictions/p3')
      .reply(200, { id: 'p3', status: 'failed', error: 'model OOM' });

    const err = (await provider().generate({ prompt: 'x', width: 64, height: 64 }).catch((e) => e)) as unknown;
    expect((err as ProviderError).code).toBe('GENERATION_FAILED');
  });

  it('throws NO_OUTPUT when succeeded but output is empty', async () => {
    nock(BASE)
      .post('/v1/models/black-forest-labs/flux-schnell/predictions')
      .reply(201, { id: 'p4', status: 'starting' });
    nock(BASE)
      .get('/v1/predictions/p4')
      .reply(200, { id: 'p4', status: 'succeeded', output: [] });

    const err = (await provider().generate({ prompt: 'x', width: 64, height: 64 }).catch((e) => e)) as unknown;
    expect((err as ProviderError).code).toBe('NO_OUTPUT');
  });

  it('polls repeatedly until succeeded', async () => {
    nock(BASE)
      .post('/v1/models/black-forest-labs/flux-schnell/predictions')
      .reply(201, { id: 'p5', status: 'starting' });
    // Two in-flight polls, then succeed.
    nock(BASE).get('/v1/predictions/p5').reply(200, { id: 'p5', status: 'starting' });
    nock(BASE).get('/v1/predictions/p5').reply(200, { id: 'p5', status: 'processing' });
    nock(BASE)
      .get('/v1/predictions/p5')
      .reply(200, {
        id: 'p5',
        status: 'succeeded',
        output: 'https://replicate.delivery/pbxt/z/out.png',
      });
    nock(CDN).get('/pbxt/z/out.png').reply(200, Buffer.from([1, 2, 3]));

    const out = await provider().generate({ prompt: 'x', width: 64, height: 64 });
    expect(Array.from(out.bytes)).toEqual([1, 2, 3]);
  });
});
