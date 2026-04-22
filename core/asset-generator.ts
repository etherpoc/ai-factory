/**
 * Asset generator — the one seam between agents and external APIs
 * (R7 外部API抽象化原則).
 *
 * - Routes an `ImageSpec`/`AudioSpec` to a provider.
 * - Consults the cache first; on hit, returns an `AssetRef` with cached=true
 *   and costUsd=0.
 * - Writes successful generations to `workspace/<proj>/assets/{images,audio}/`
 *   AND to the cache side-by-side (same bytes, different symlink-like paths).
 * - Tracks cumulative USD. Callers pre-flight with `estimateCost` for budget
 *   enforcement.
 *
 * The generator itself is budget-unaware: deciding whether to proceed when
 * we're over budget is the job of the caller (agent or orchestrator). We
 * just report accurately.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { createAssetCache, type AssetCache, type CacheMetadata } from './asset-cache.js';
import type {
  AssetRef,
  AudioProvider,
  AudioSpec,
  ImageProvider,
  ImageSpec,
} from './providers/types.js';
import { ProviderError } from './providers/types.js';
import type {
  AudioProviderRegistry,
} from './providers/audio/index.js';
import type {
  ImageProviderRegistry,
} from './providers/image/index.js';
import type { Logger } from './types.js';

export interface AssetGeneratorOptions {
  imageProviders: ImageProviderRegistry;
  audioProviders: AudioProviderRegistry;
  cache?: AssetCache;
  logger?: Logger;
  /**
   * If set, `generate*` short-circuits when cumulative cost would exceed the
   * cap and throws `ProviderError(BUDGET_EXCEEDED)`. `null`/undefined = no
   * enforcement (caller handles budgeting). See R9.
   */
  assetBudgetUsd?: number;
}

export interface AssetGenerator {
  generateImage(spec: ImageSpec, workspaceDir: string): Promise<AssetRef>;
  generateAudio(spec: AudioSpec, workspaceDir: string): Promise<AssetRef>;
  estimateCost(spec: ImageSpec | AudioSpec): number;
  /** Running total across the generator's lifetime (not including cache hits). */
  readonly spentUsd: number;
  /** List provider names for diagnostics. */
  providerNames(): { image: string[]; audio: string[] };
}

export function createAssetGenerator(opts: AssetGeneratorOptions): AssetGenerator {
  const cache = opts.cache ?? createAssetCache();
  const logger = opts.logger;
  let spentUsd = 0;

  return {
    get spentUsd() {
      return spentUsd;
    },

    providerNames() {
      return {
        image: opts.imageProviders.list().map((p) => p.name),
        audio: opts.audioProviders.list().map((p) => p.name),
      };
    },

    estimateCost(spec: ImageSpec | AudioSpec): number {
      if (isImageSpec(spec)) {
        const p = pickImage(opts.imageProviders, spec);
        return p.estimateCost(spec);
      }
      const p = pickAudio(opts.audioProviders, spec);
      return p.estimateCost(spec);
    },

    async generateImage(spec: ImageSpec, workspaceDir: string): Promise<AssetRef> {
      const provider = pickImage(opts.imageProviders, spec);
      const params = {
        width: spec.width,
        height: spec.height,
        negativePrompt: spec.negativePrompt ?? null,
        style: spec.style ?? null,
        seed: spec.seed ?? null,
      };
      const key = cache.computeKey({
        provider: provider.name,
        model: getProviderModel(provider),
        prompt: spec.prompt,
        params,
      });
      const ext = 'png';

      // ---- Cache hit
      const hit = await cache.get(workspaceDir, key, ext);
      if (hit) {
        logger?.info('asset cache hit', { kind: 'image', key, provider: provider.name });
        const assetPath = await copyToAssets(workspaceDir, 'images', key, ext, hit.bytes);
        return {
          path: assetPath,
          relPath: relative(workspaceDir, assetPath),
          cached: true,
          costUsd: 0,
          provider: provider.name,
          cacheKey: key,
          metadata: hit.metadata,
        };
      }

      // ---- Budget pre-check
      if (opts.assetBudgetUsd !== undefined) {
        const est = provider.estimateCost(spec);
        if (spentUsd + est > opts.assetBudgetUsd) {
          throw new ProviderError({
            message: `asset budget exceeded: $${(spentUsd + est).toFixed(4)} > $${opts.assetBudgetUsd.toFixed(4)}`,
            code: 'ASSET_BUDGET_EXCEEDED',
            provider: provider.name,
            retryable: false,
          });
        }
      }

      // ---- Generate
      const out = await provider.generate(spec);
      spentUsd += out.costUsd;

      // ---- Persist: cache + assets dir (both from the same bytes)
      const metadata: CacheMetadata = {
        provider: provider.name,
        model: getProviderModel(provider),
        prompt: spec.prompt,
        params,
        createdAt: new Date().toISOString(),
        costUsd: out.costUsd,
        mimeType: out.mimeType,
      };
      await cache.set(workspaceDir, key, ext, out.bytes, metadata);
      const assetPath = await writeAsset(workspaceDir, 'images', key, ext, out.bytes);
      logger?.info('asset generated', {
        kind: 'image',
        provider: provider.name,
        key,
        costUsd: +out.costUsd.toFixed(5),
        width: spec.width,
        height: spec.height,
      });
      return {
        path: assetPath,
        relPath: relative(workspaceDir, assetPath),
        cached: false,
        costUsd: out.costUsd,
        provider: provider.name,
        cacheKey: key,
        metadata: { ...metadata, ...out.metadata },
      };
    },

    async generateAudio(spec: AudioSpec, workspaceDir: string): Promise<AssetRef> {
      const provider = pickAudio(opts.audioProviders, spec);
      const params = {
        kind: spec.kind,
        durationSec: spec.durationSec,
        promptInfluence: spec.promptInfluence ?? null,
      };
      const key = cache.computeKey({
        provider: provider.name,
        model: getProviderModel(provider),
        prompt: spec.prompt,
        params,
      });
      const ext = 'mp3';

      const hit = await cache.get(workspaceDir, key, ext);
      if (hit) {
        logger?.info('asset cache hit', { kind: spec.kind, key, provider: provider.name });
        const assetPath = await copyToAssets(workspaceDir, 'audio', key, ext, hit.bytes);
        return {
          path: assetPath,
          relPath: relative(workspaceDir, assetPath),
          cached: true,
          costUsd: 0,
          provider: provider.name,
          cacheKey: key,
          metadata: hit.metadata,
        };
      }

      if (opts.assetBudgetUsd !== undefined) {
        const est = provider.estimateCost(spec);
        if (spentUsd + est > opts.assetBudgetUsd) {
          throw new ProviderError({
            message: `asset budget exceeded: $${(spentUsd + est).toFixed(4)} > $${opts.assetBudgetUsd.toFixed(4)}`,
            code: 'ASSET_BUDGET_EXCEEDED',
            provider: provider.name,
            retryable: false,
          });
        }
      }

      const out = await provider.generate(spec);
      spentUsd += out.costUsd;

      const metadata: CacheMetadata = {
        provider: provider.name,
        model: getProviderModel(provider),
        prompt: spec.prompt,
        params,
        createdAt: new Date().toISOString(),
        costUsd: out.costUsd,
        mimeType: out.mimeType,
      };
      await cache.set(workspaceDir, key, ext, out.bytes, metadata);
      const assetPath = await writeAsset(workspaceDir, 'audio', key, ext, out.bytes);
      logger?.info('asset generated', {
        kind: spec.kind,
        provider: provider.name,
        key,
        costUsd: +out.costUsd.toFixed(5),
        durationSec: spec.durationSec,
      });
      return {
        path: assetPath,
        relPath: relative(workspaceDir, assetPath),
        cached: false,
        costUsd: out.costUsd,
        provider: provider.name,
        cacheKey: key,
        metadata: { ...metadata, ...out.metadata },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isImageSpec(spec: ImageSpec | AudioSpec): spec is ImageSpec {
  return 'width' in spec && 'height' in spec;
}

function pickImage(reg: ImageProviderRegistry, spec: ImageSpec): ImageProvider {
  if (spec.provider && spec.provider !== 'auto') {
    const p = reg.get(spec.provider);
    if (!p) {
      throw new ProviderError({
        message: `no image provider named "${spec.provider}" is registered`,
        code: 'PROVIDER_NOT_FOUND',
        provider: spec.provider,
      });
    }
    return p;
  }
  const picked = reg.pickDefault();
  if (!picked) {
    throw new ProviderError({
      message: 'no image providers are registered',
      code: 'NO_PROVIDERS',
      provider: 'none',
    });
  }
  return picked;
}

function pickAudio(reg: AudioProviderRegistry, spec: AudioSpec): AudioProvider {
  if (spec.provider && spec.provider !== 'auto') {
    const p = reg.get(spec.provider);
    if (!p) {
      throw new ProviderError({
        message: `no audio provider named "${spec.provider}" is registered`,
        code: 'PROVIDER_NOT_FOUND',
        provider: spec.provider,
      });
    }
    return p;
  }
  const picked = reg.pickDefault();
  if (!picked) {
    throw new ProviderError({
      message: 'no audio providers are registered',
      code: 'NO_PROVIDERS',
      provider: 'none',
    });
  }
  return picked;
}

function getProviderModel(p: ImageProvider | AudioProvider): string {
  // Providers don't expose their model id uniformly; we use the name plus
  // a placeholder so the cache key remains stable. When a provider gains
  // a public `model` field we can wire it in.
  return p.name;
}

async function writeAsset(
  workspaceDir: string,
  sub: 'images' | 'audio',
  key: string,
  ext: string,
  bytes: Uint8Array,
): Promise<string> {
  const dir = join(workspaceDir, 'assets', sub);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${key.slice(0, 12)}.${ext}`);
  await writeFile(path, bytes);
  return path;
}

/** Write cached bytes into the assets dir so downstream code doesn't have to reach into `.cache/`. */
async function copyToAssets(
  workspaceDir: string,
  sub: 'images' | 'audio',
  key: string,
  ext: string,
  bytes: Uint8Array,
): Promise<string> {
  return writeAsset(workspaceDir, sub, key, ext, bytes);
}

/** Re-export so callers only need one import path. */
export type { AssetCache };
export { ProviderError };
export type { AssetRef, ImageSpec, AudioSpec } from './providers/types.js';
