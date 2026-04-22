/**
 * Shared types for the external-asset provider layer (Phase 11.a.1).
 *
 * Design goals (R7 外部API抽象化原則):
 *   - Agents never import a specific provider; they talk to `asset-generator`
 *     which routes to a provider via these interfaces.
 *   - Swapping Replicate → Fal.ai or ElevenLabs → Suno later must not require
 *     changes outside `core/providers/`.
 *   - All identity (prompt + params) goes through one `CacheKeyInput` helper so
 *     the cache layer stays coherent across providers.
 */

// ---------------------------------------------------------------------------
// Image
// ---------------------------------------------------------------------------

export type ImageStyle = 'pixel-art' | 'illustration' | 'photo' | 'icon' | 'ui';

export interface ImageSpec {
  /** Natural-language description of the desired image. */
  prompt: string;
  /** Things to avoid (anatomy errors, watermarks, …). Optional. */
  negativePrompt?: string;
  width: number;
  height: number;
  /** Style hint. Providers may add it to the prompt or pick a LoRA. */
  style?: ImageStyle;
  /** `'auto'` picks the best-fit provider; a name forces one. */
  provider?: 'auto' | 'replicate' | string;
  /** Seed for determinism where the provider supports it. */
  seed?: number;
  /** Per-call timeout in ms (overrides provider default). */
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------

export type AudioKind = 'bgm' | 'sfx' | 'voice';

export interface AudioSpec {
  kind: AudioKind;
  /** Natural-language description. ElevenLabs calls this "text". */
  prompt: string;
  /** Target duration. Providers clamp to their supported range. */
  durationSec: number;
  provider?: 'auto' | 'elevenlabs' | string;
  /**
   * 0..1, controls how closely the provider follows the prompt vs. taking
   * creative liberty. ElevenLabs calls this `prompt_influence` (default 0.3).
   */
  promptInfluence?: number;
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export interface AssetRef {
  /** Absolute path to the asset file on disk. */
  path: string;
  /** Relative path from the workspace root. */
  relPath: string;
  /** True if this request was served from cache (no external API call). */
  cached: boolean;
  /** USD cost attributed to this call. Zero for cache hits. */
  costUsd: number;
  /** Provider name (`"replicate"`, `"elevenlabs"`, …). */
  provider: string;
  /** Content-addressed SHA-256 prefix used as the cache key. */
  cacheKey: string;
  /** Opaque provider metadata (model id, latency, etc.). */
  metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Provider contracts
// ---------------------------------------------------------------------------

export interface ImageProvider {
  readonly name: string;
  /** True if this provider can fulfill the spec. Used by the registry to pick. */
  supports(spec: ImageSpec): boolean;
  /** USD cost estimate without calling the API (for budget pre-checks). */
  estimateCost(spec: ImageSpec): number;
  /** Return raw bytes (PNG/JPEG) plus per-call metadata. */
  generate(spec: ImageSpec): Promise<ProviderOutput>;
}

export interface AudioProvider {
  readonly name: string;
  supports(spec: AudioSpec): boolean;
  estimateCost(spec: AudioSpec): number;
  /** Return raw bytes (MP3/WAV) plus per-call metadata. */
  generate(spec: AudioSpec): Promise<ProviderOutput>;
}

export interface ProviderOutput {
  /** Raw asset bytes. */
  bytes: Uint8Array;
  /** Reported mime type, e.g. `image/png`, `audio/mpeg`. */
  mimeType: string;
  /** Actual cost after the call (providers may charge variable). Defaults to `estimateCost` when the provider can't resolve it. */
  costUsd: number;
  /** Free-form extras (latency, model version, rate-limit headers). */
  metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Provider config
// ---------------------------------------------------------------------------

export interface ReplicateConfig {
  apiToken: string;
  /** Model slug, default: `stability-ai/sdxl`. */
  model?: string;
  /** Max concurrent requests (rate-limit). Default: 2. */
  concurrency?: number;
  /** Total timeout per generation (prediction creation + polling). Default 120_000 ms. */
  timeoutMs?: number;
  /** Injected fetch (tests use nock-wrapped fetch). */
  fetchImpl?: typeof fetch;
}

export interface ElevenLabsConfig {
  apiKey: string;
  /** Max concurrent requests. Default: 2. */
  concurrency?: number;
  /** Max duration the SFX endpoint will accept. Default 22 s. */
  maxDurationSec?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ProviderError extends Error {
  readonly code: string;
  readonly provider: string;
  readonly retryable: boolean;
  readonly statusCode?: number;
  readonly body?: string;

  constructor(opts: {
    message: string;
    code: string;
    provider: string;
    retryable?: boolean;
    statusCode?: number;
    body?: string;
    cause?: unknown;
  }) {
    super(opts.message, opts.cause ? { cause: opts.cause } : undefined);
    this.name = 'ProviderError';
    this.code = opts.code;
    this.provider = opts.provider;
    this.retryable = opts.retryable ?? false;
    if (opts.statusCode !== undefined) this.statusCode = opts.statusCode;
    if (opts.body !== undefined) this.body = opts.body;
  }
}

// ---------------------------------------------------------------------------
// Cache key input
// ---------------------------------------------------------------------------

export interface CacheKeyInput {
  provider: string;
  /** Provider-internal model identifier. */
  model: string;
  /** Full prompt as sent. */
  prompt: string;
  /** Any params that affect the output (width, seed, duration, …). */
  params: Record<string, unknown>;
}
