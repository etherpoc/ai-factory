/**
 * Phase 11.a.2 regression for core/tools/asset-tools.ts.
 *
 * These tools are the seam between a creative agent's tool-use loop and the
 * AssetGenerator. Tests verify:
 *   - tool descriptors are well-formed (name, description, inputSchema)
 *   - generate_image wraps generateImage and returns a pared-down output
 *   - generate_audio validates kind (bgm|sfx) and rejects voice
 *   - tool errors are surfaced as `{ ok: false, error }` instead of thrown
 */
import { describe, expect, it } from 'vitest';
import {
  createGenerateAudioTool,
  createGenerateImageTool,
} from '../../core/tools/asset-tools.js';
import type { AssetGenerator } from '../../core/asset-generator.js';
import type { ToolContext } from '../../core/types.js';
import { nullLogger } from '../../core/logger.js';
import { ProviderError } from '../../core/providers/types.js';

function fakeGenerator(
  overrides: Partial<AssetGenerator> = {},
): AssetGenerator {
  return {
    spentUsd: 0,
    providerNames: () => ({ image: ['replicate'], audio: ['elevenlabs'] }),
    estimateCost: () => 0.003,
    async generateImage(spec, _wsDir) {
      return {
        path: '/abs/assets/images/x.png',
        relPath: 'assets/images/x.png',
        cached: false,
        costUsd: 0.003,
        provider: 'replicate',
        cacheKey: 'a'.repeat(64),
        metadata: { width: spec.width, height: spec.height },
      };
    },
    async generateAudio(spec, _wsDir) {
      return {
        path: '/abs/assets/audio/y.mp3',
        relPath: 'assets/audio/y.mp3',
        cached: spec.kind === 'bgm',
        costUsd: 0,
        provider: 'elevenlabs',
        cacheKey: 'b'.repeat(64),
        metadata: { kind: spec.kind, durationSec: spec.durationSec },
      };
    },
    ...overrides,
  };
}

function ctx(): ToolContext {
  return { workspaceDir: '/tmp/ws', projectId: 'p', logger: nullLogger };
}

describe('core/tools/asset-tools — generate_image', () => {
  it('has a well-formed descriptor', () => {
    const tool = createGenerateImageTool(fakeGenerator());
    expect(tool.name).toBe('generate_image');
    expect(tool.description).toMatch(/image/i);
    const schema = tool.inputSchema as { required: string[]; properties: Record<string, unknown> };
    expect(schema.required).toContain('prompt');
    expect(schema.required).toContain('width');
    expect(schema.required).toContain('height');
    expect(Object.keys(schema.properties)).toContain('style');
  });

  it('forwards prompt + width/height and returns a short result', async () => {
    const tool = createGenerateImageTool(fakeGenerator());
    const res = await tool.run({ prompt: 'blue', width: 256, height: 256 }, ctx());
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.output).toMatchObject({
        relPath: 'assets/images/x.png',
        provider: 'replicate',
        cached: false,
        costUsd: 0.003,
      });
    }
  });

  it('passes optional fields through when present', async () => {
    let capturedSpec: unknown;
    const gen = fakeGenerator({
      async generateImage(spec, _ws) {
        capturedSpec = spec;
        return {
          path: '/p',
          relPath: 'r',
          cached: false,
          costUsd: 0.003,
          provider: 'replicate',
          cacheKey: 'k'.repeat(64),
          metadata: {},
        };
      },
    });
    const tool = createGenerateImageTool(gen);
    await tool.run(
      { prompt: 'x', width: 512, height: 512, negative_prompt: 'blurry', style: 'pixel-art', seed: 7 },
      ctx(),
    );
    expect(capturedSpec).toMatchObject({
      prompt: 'x',
      width: 512,
      height: 512,
      negativePrompt: 'blurry',
      style: 'pixel-art',
      seed: 7,
    });
  });

  it('returns ok:false instead of throwing when the generator fails', async () => {
    const gen = fakeGenerator({
      async generateImage(_spec, _ws) {
        throw new ProviderError({
          message: 'boom',
          code: 'RATE_LIMIT',
          provider: 'replicate',
          retryable: true,
        });
      },
    });
    const tool = createGenerateImageTool(gen);
    const res = await tool.run({ prompt: 'x', width: 64, height: 64 }, ctx());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('boom');
  });

  it('rejects bad args with a clear message', async () => {
    const tool = createGenerateImageTool(fakeGenerator());
    const res = await tool.run({ prompt: 'x', width: 'huge' as unknown as number, height: 64 }, ctx());
    expect(res.ok).toBe(false);
  });
});

describe('core/tools/asset-tools — generate_audio', () => {
  it('has a well-formed descriptor', () => {
    const tool = createGenerateAudioTool(fakeGenerator());
    expect(tool.name).toBe('generate_audio');
    const schema = tool.inputSchema as { required: string[]; properties: Record<string, unknown> };
    expect(schema.required).toEqual(expect.arrayContaining(['prompt', 'kind', 'duration_seconds']));
  });

  it('accepts sfx and bgm kinds', async () => {
    const tool = createGenerateAudioTool(fakeGenerator());
    const sfx = await tool.run({ prompt: 'zap', kind: 'sfx', duration_seconds: 0.5 }, ctx());
    expect(sfx.ok).toBe(true);
    const bgm = await tool.run({ prompt: 'loop', kind: 'bgm', duration_seconds: 10 }, ctx());
    expect(bgm.ok).toBe(true);
    if (bgm.ok) expect((bgm.output as { cached: boolean }).cached).toBe(true);
  });

  it('rejects invalid kind values with ok:false', async () => {
    const tool = createGenerateAudioTool(fakeGenerator());
    const res = await tool.run({ prompt: 'x', kind: 'voice', duration_seconds: 1 }, ctx());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/invalid kind/);
  });

  it('passes prompt_influence through when present', async () => {
    let captured: unknown;
    const gen = fakeGenerator({
      async generateAudio(spec, _ws) {
        captured = spec;
        return {
          path: '/p',
          relPath: 'r',
          cached: false,
          costUsd: 0.01,
          provider: 'elevenlabs',
          cacheKey: 'k'.repeat(64),
          metadata: {},
        };
      },
    });
    const tool = createGenerateAudioTool(gen);
    await tool.run(
      { prompt: 'x', kind: 'sfx', duration_seconds: 1, prompt_influence: 0.6 },
      ctx(),
    );
    expect(captured).toMatchObject({ kind: 'sfx', promptInfluence: 0.6 });
  });
});
