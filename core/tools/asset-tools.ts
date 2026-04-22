/**
 * Tools that expose the asset generator to agents.
 *
 * These are constructed per-invocation (they close over a specific
 * `AssetGenerator` instance) because the generator tracks cumulative cost and
 * enforces the per-run asset budget. Each agent creation path that wants
 * image/audio capability threads its generator through here.
 *
 * Agents never import `core/asset-generator` directly — they call the tools
 * below through the standard tool-use loop.
 */
import type { AssetGenerator } from '../asset-generator.js';
import type { Tool } from '../types.js';

export function createGenerateImageTool(gen: AssetGenerator): Tool {
  return {
    name: 'generate_image',
    description:
      'Generate an image asset with the configured provider (Replicate SDXL by default). Returns `{ relPath, costUsd, cached }`. Idempotent: identical prompt+params reuses the cache.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Natural-language description of the image' },
        negative_prompt: { type: 'string', description: 'Things to avoid (e.g. "blurry, watermark")' },
        width: { type: 'number', description: 'Width in pixels (e.g. 512, 1024)' },
        height: { type: 'number', description: 'Height in pixels' },
        style: {
          type: 'string',
          enum: ['pixel-art', 'illustration', 'photo', 'icon', 'ui'],
          description: 'Style hint (optional)',
        },
        seed: { type: 'number', description: 'Seed for reproducibility (optional)' },
      },
      required: ['prompt', 'width', 'height'],
    },
    async run(args, ctx) {
      try {
        const prompt = argStr(args, 'prompt');
        const width = argNum(args, 'width');
        const height = argNum(args, 'height');
        const ref = await gen.generateImage(
          {
            prompt,
            width,
            height,
            ...(typeof args.negative_prompt === 'string' ? { negativePrompt: args.negative_prompt } : {}),
            ...(isStyle(args.style) ? { style: args.style } : {}),
            ...(typeof args.seed === 'number' ? { seed: args.seed } : {}),
          },
          ctx.workspaceDir,
        );
        return {
          ok: true,
          output: {
            relPath: ref.relPath,
            provider: ref.provider,
            cached: ref.cached,
            costUsd: ref.costUsd,
            cacheKey: ref.cacheKey.slice(0, 12),
          },
        };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  };
}

export function createGenerateAudioTool(gen: AssetGenerator): Tool {
  return {
    name: 'generate_audio',
    description:
      'Generate an audio asset (BGM or SFX) with the configured provider (ElevenLabs by default). Returns `{ relPath, costUsd, cached }`. Duration is capped by the provider (ElevenLabs: 22 s).',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Natural-language description of the sound' },
        kind: {
          type: 'string',
          enum: ['bgm', 'sfx'],
          description: 'bgm = ambient background music; sfx = short effect',
        },
        duration_seconds: { type: 'number', description: 'Target duration (0.5 – 22)' },
        prompt_influence: {
          type: 'number',
          description: '0..1, higher = stick closer to prompt (default 0.3)',
        },
      },
      required: ['prompt', 'kind', 'duration_seconds'],
    },
    async run(args, ctx) {
      try {
        const prompt = argStr(args, 'prompt');
        const kind = argStr(args, 'kind');
        const durationSec = argNum(args, 'duration_seconds');
        if (kind !== 'bgm' && kind !== 'sfx') {
          return { ok: false, error: `invalid kind: ${kind} (expected bgm | sfx)` };
        }
        const ref = await gen.generateAudio(
          {
            kind,
            prompt,
            durationSec,
            ...(typeof args.prompt_influence === 'number' ? { promptInfluence: args.prompt_influence } : {}),
          },
          ctx.workspaceDir,
        );
        return {
          ok: true,
          output: {
            relPath: ref.relPath,
            provider: ref.provider,
            cached: ref.cached,
            costUsd: ref.costUsd,
            cacheKey: ref.cacheKey.slice(0, 12),
          },
        };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// argument helpers (kept local; path-safety not relevant since we don't touch fs directly)
// ---------------------------------------------------------------------------

function argStr(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== 'string') throw new Error(`${key} must be string`);
  return v;
}

function argNum(args: Record<string, unknown>, key: string): number {
  const v = args[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${key} must be a finite number`);
  return v;
}

function isStyle(v: unknown): v is 'pixel-art' | 'illustration' | 'photo' | 'icon' | 'ui' {
  return v === 'pixel-art' || v === 'illustration' || v === 'photo' || v === 'icon' || v === 'ui';
}
