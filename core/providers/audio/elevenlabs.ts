/**
 * ElevenLabs (ElevenCreative) audio provider (Phase 11.a.1).
 *
 * ElevenLabs exposes a `/v1/sound-generation` endpoint that accepts a text
 * prompt + duration and returns an MP3. We use it for both SFX and BGM:
 *
 *   - SFX:  short, 0.5–5 s
 *   - BGM:  longer, capped at `maxDurationSec` (default 22 s, the API cap).
 *           For truly long tracks (30+ s) the programmer should loop the
 *           output — the BGM manifest's `loop: true` flag handles this.
 *
 * API:
 *   POST https://api.elevenlabs.io/v1/sound-generation
 *   headers: { xi-api-key: <KEY>, Content-Type: application/json }
 *   body:    { text, duration_seconds, prompt_influence }
 *   response: binary audio/mpeg
 *
 * **TOS注意**: ElevenLabs の SFX も商用利用可。音声クローンや実在人物を
 * 模倣するプロンプトは生成しないことを `sound` エージェントのシステム
 * プロンプトで統制する (spec 注意事項 1)。
 */
import pLimit from 'p-limit';
import { ProviderError, type AudioProvider, type AudioSpec, type ElevenLabsConfig, type ProviderOutput } from '../types.js';

const ELEVENLABS_API_BASE = 'https://api.elevenlabs.io/v1';
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_DURATION_SEC = 22;

/**
 * ElevenLabs sound-generation list price as of 2026-04: roughly $0.08 per
 * minute of generated audio. We charge per second: 0.08 / 60 ≈ $0.00133/s.
 * Callers that care about accuracy rely on the server-reported billing.
 */
const USD_PER_SECOND = 0.08 / 60;

export function createElevenLabsProvider(config: ElevenLabsConfig): AudioProvider {
  if (!config.apiKey || config.apiKey.trim() === '') {
    throw new ProviderError({
      message: 'ELEVENLABS_API_KEY is empty',
      code: 'API_KEY_MISSING',
      provider: 'elevenlabs',
    });
  }
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxDurationSec = config.maxDurationSec ?? DEFAULT_MAX_DURATION_SEC;
  const limit = pLimit(config.concurrency ?? 2);
  const fetchImpl: typeof fetch = config.fetchImpl ?? fetch;

  return {
    name: 'elevenlabs',

    supports(spec: AudioSpec): boolean {
      // We support sfx/bgm via sound-generation. Voice generation
      // (TTS) is a different endpoint and is out of scope for Phase 11.a.
      return spec.kind !== 'voice';
    },

    estimateCost(spec: AudioSpec): number {
      const clamped = Math.min(spec.durationSec, maxDurationSec);
      return +(clamped * USD_PER_SECOND).toFixed(5);
    },

    generate(spec: AudioSpec): Promise<ProviderOutput> {
      return limit(() => generateOnce(spec, { apiKey: config.apiKey, timeoutMs, maxDurationSec, fetchImpl }));
    },
  };
}

// ---------------------------------------------------------------------------

interface CallCtx {
  apiKey: string;
  timeoutMs: number;
  maxDurationSec: number;
  fetchImpl: typeof fetch;
}

async function generateOnce(spec: AudioSpec, ctx: CallCtx): Promise<ProviderOutput> {
  if (spec.kind === 'voice') {
    throw new ProviderError({
      message: 'elevenlabs: voice (TTS) not supported through this provider in Phase 11.a',
      code: 'UNSUPPORTED_KIND',
      provider: 'elevenlabs',
    });
  }

  const duration = Math.min(Math.max(spec.durationSec, 0.5), ctx.maxDurationSec);
  const text = framePromptByKind(spec);
  const effectiveTimeout = spec.timeoutMs ?? ctx.timeoutMs;

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), effectiveTimeout);
  const started = Date.now();

  try {
    const res = await ctx.fetchImpl(`${ELEVENLABS_API_BASE}/sound-generation`, {
      method: 'POST',
      signal: ac.signal,
      headers: {
        'xi-api-key': ctx.apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        duration_seconds: duration,
        prompt_influence: spec.promptInfluence ?? 0.3,
      }),
    });
    if (!res.ok) {
      const body = await safeReadBody(res);
      throw new ProviderError({
        message: `elevenlabs: sound-generation failed (${res.status})`,
        code: res.status === 429 ? 'RATE_LIMIT' : res.status === 401 ? 'UNAUTHORIZED' : 'REQUEST_FAILED',
        provider: 'elevenlabs',
        statusCode: res.status,
        retryable: res.status === 429 || res.status >= 500,
        body,
      });
    }
    const mimeType = res.headers.get('content-type') ?? 'audio/mpeg';
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    if (bytes.byteLength === 0) {
      throw new ProviderError({
        message: 'elevenlabs: empty audio body',
        code: 'EMPTY_BODY',
        provider: 'elevenlabs',
      });
    }
    return {
      bytes,
      mimeType,
      costUsd: +(duration * USD_PER_SECOND).toFixed(5),
      metadata: {
        durationSec: duration,
        promptInfluence: spec.promptInfluence ?? 0.3,
        latencyMs: Date.now() - started,
        kind: spec.kind,
      },
    };
  } finally {
    clearTimeout(t);
  }
}

/**
 * For BGM, prefix with "ambient music track," so the SFX endpoint (which is
 * biased toward short effects) leans musical. This is a pragmatic framing —
 * when/if ElevenLabs ships a dedicated music endpoint, we switch.
 */
function framePromptByKind(spec: AudioSpec): string {
  if (spec.kind === 'bgm') {
    return `background music loop: ${spec.prompt}`;
  }
  return spec.prompt;
}

async function safeReadBody(res: Response): Promise<string | undefined> {
  try {
    const t = await res.text();
    return t.length > 2000 ? t.slice(0, 2000) + '…' : t;
  } catch {
    return undefined;
  }
}
