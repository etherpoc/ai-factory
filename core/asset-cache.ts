/**
 * Content-addressed asset cache (R8 アセットキャッシュ原則).
 *
 * Stored under `workspace/<proj>/assets/.cache/<prefix>/<full>.<ext>` with a
 * sibling `.meta.json` holding provider metadata. `<prefix>` is the first 2
 * hex chars of the SHA-256; keeping files two levels deep protects the FS
 * from dumping thousands of siblings in one directory.
 *
 * Cache scope is **per workspace** — we deliberately don't share across
 * projects. This keeps `uaf clean` simple (remove the workspace, and the
 * cache goes with it) and preserves the "portable" property of a generated
 * project: copying a workspace to another machine carries its cache.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { CacheKeyInput } from './providers/types.js';

export const CACHE_DIR = join('assets', '.cache');

export interface CacheHit {
  bytes: Uint8Array;
  metadata: Record<string, unknown>;
  key: string;
  /** Absolute path of the cached file. */
  path: string;
}

export interface CacheMetadata {
  provider: string;
  model: string;
  prompt: string;
  params: Record<string, unknown>;
  /** ISO-8601 timestamp when the asset was generated. */
  createdAt: string;
  /** USD cost at generation time. Reported back as 0 on cache hits. */
  costUsd: number;
  /** Content type (mime), useful for write-back. */
  mimeType: string;
}

export interface AssetCache {
  computeKey(input: CacheKeyInput): string;
  get(workspaceDir: string, key: string, ext: string): Promise<CacheHit | null>;
  set(
    workspaceDir: string,
    key: string,
    ext: string,
    bytes: Uint8Array,
    metadata: CacheMetadata,
  ): Promise<string>;
  /** Absolute path a given key would live at. Useful for diagnostics. */
  resolvePath(workspaceDir: string, key: string, ext: string): string;
}

export function createAssetCache(): AssetCache {
  return {
    computeKey(input: CacheKeyInput): string {
      return sha256Of(canonicalize(input));
    },

    resolvePath(workspaceDir: string, key: string, ext: string): string {
      const safeExt = normalizeExt(ext);
      const prefix = key.slice(0, 2);
      return join(workspaceDir, CACHE_DIR, prefix, `${key}.${safeExt}`);
    },

    async get(workspaceDir: string, key: string, ext: string): Promise<CacheHit | null> {
      const path = this.resolvePath(workspaceDir, key, ext);
      try {
        await stat(path);
      } catch {
        return null;
      }
      const bytes = await readFile(path);
      let metadata: Record<string, unknown> = {};
      try {
        const meta = await readFile(path + '.meta.json', 'utf8');
        metadata = JSON.parse(meta) as Record<string, unknown>;
      } catch {
        // A missing or corrupt meta sidecar is non-fatal — return bytes as-is.
      }
      return { bytes, metadata, key, path };
    },

    async set(
      workspaceDir: string,
      key: string,
      ext: string,
      bytes: Uint8Array,
      metadata: CacheMetadata,
    ): Promise<string> {
      const path = this.resolvePath(workspaceDir, key, ext);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes);
      await writeFile(path + '.meta.json', JSON.stringify(metadata, null, 2), 'utf8');
      return path;
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function canonicalize(input: CacheKeyInput): string {
  // Stable ordering: sort keys recursively so object-field order doesn't
  // affect the hash. The prompt is included verbatim (whitespace matters).
  return JSON.stringify(
    {
      provider: input.provider,
      model: input.model,
      prompt: input.prompt,
      params: sortObject(input.params),
    },
    null,
    0,
  );
}

function sortObject(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortObject);
  if (v !== null && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = sortObject((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}

function sha256Of(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function normalizeExt(ext: string): string {
  const trimmed = ext.replace(/^\./, '').toLowerCase();
  // Restrict to common asset extensions. Unknown values fall through
  // unchanged (we trust the caller — providers are the caller).
  return /^[a-z0-9]{1,8}$/.test(trimmed) ? trimmed : 'bin';
}
