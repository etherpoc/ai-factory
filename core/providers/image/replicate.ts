/**
 * Replicate SDXL provider (Phase 11.a.1).
 *
 * API flow:
 *   1. POST /v1/models/<owner>/<model>/predictions  → { id, status }
 *   2. Poll GET /v1/predictions/<id>                → { status, output }
 *   3. Download output[0] URL                       → raw PNG bytes
 *
 * Reference: https://replicate.com/docs/reference/http
 *
 * **TOS注意**: Replicate の生成物は商用利用可だが、モデルごとのライセンスに従う。
 * SDXL は CreativeML Open RAIL++-M License（商用可、明示的に禁止される用途を除く）。
 * 実在人物・著名キャラクターを模倣するプロンプトを生成しないことはエージェント側
 * のシステムプロンプトで統制する (spec 注意事項 1)。
 */
import pLimit from 'p-limit';
import { ProviderError, type ImageProvider, type ImageSpec, type ProviderOutput, type ReplicateConfig } from '../types.js';

// 2026-04: Replicate removed the short `stability-ai/sdxl` model endpoint,
// so we default to Flux Schnell (black-forest-labs/flux-schnell). It's cheap,
// fast (1–2 s), and supported via the same /v1/models/<slug>/predictions
// shape. Callers that need SDXL can still override via `config.model`, but
// note SDXL now requires a version hash submitted to /v1/predictions.
const DEFAULT_MODEL = 'black-forest-labs/flux-schnell';
const DEFAULT_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 1000;
/** Flux Schnell list price as of 2026-04: ~$0.003 per image. */
const PER_IMAGE_USD = 0.003;

const REPLICATE_API_BASE = 'https://api.replicate.com/v1';

export function createReplicateProvider(config: ReplicateConfig): ImageProvider {
  if (!config.apiToken || config.apiToken.trim() === '') {
    throw new ProviderError({
      message: 'REPLICATE_API_TOKEN is empty',
      code: 'API_KEY_MISSING',
      provider: 'replicate',
    });
  }
  const model = config.model ?? DEFAULT_MODEL;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const limit = pLimit(config.concurrency ?? 2);
  const fetchImpl: typeof fetch = config.fetchImpl ?? fetch;

  return {
    name: 'replicate',

    supports(_spec: ImageSpec): boolean {
      return true;
    },

    estimateCost(_spec: ImageSpec): number {
      return PER_IMAGE_USD;
    },

    generate(spec: ImageSpec): Promise<ProviderOutput> {
      return limit(() => generateOnce(spec, { apiToken: config.apiToken, model, timeoutMs, fetchImpl }));
    },
  };
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

interface CallCtx {
  apiToken: string;
  model: string;
  timeoutMs: number;
  fetchImpl: typeof fetch;
}

async function generateOnce(spec: ImageSpec, ctx: CallCtx): Promise<ProviderOutput> {
  const effectiveTimeout = spec.timeoutMs ?? ctx.timeoutMs;
  const deadline = Date.now() + effectiveTimeout;
  const started = Date.now();

  const input = buildInput(spec, ctx.model);
  const prediction = await createPrediction(ctx, input);
  const output = await pollUntilComplete(ctx, prediction.id, deadline);
  const outUrl = Array.isArray(output) ? output[0] : output;
  if (typeof outUrl !== 'string' || outUrl.length === 0) {
    throw new ProviderError({
      message: 'replicate: prediction finished without an output URL',
      code: 'NO_OUTPUT',
      provider: 'replicate',
      body: JSON.stringify(output),
    });
  }
  const bytes = await download(ctx, outUrl, deadline);

  // Replicate's output URL extension often drives the mime type; fall back to
  // PNG for the most common case (both SDXL and Flux default to PNG).
  const mimeType = outUrl.endsWith('.webp')
    ? 'image/webp'
    : outUrl.endsWith('.jpg') || outUrl.endsWith('.jpeg')
      ? 'image/jpeg'
      : 'image/png';
  return {
    bytes,
    mimeType,
    costUsd: PER_IMAGE_USD,
    metadata: {
      model: ctx.model,
      predictionId: prediction.id,
      latencyMs: Date.now() - started,
      outputUrl: outUrl,
    },
  };
}

interface PredictionResponse {
  id: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  output?: unknown;
  error?: string | null;
  logs?: string;
}

function buildInput(spec: ImageSpec, model: string): Record<string, unknown> {
  const inp: Record<string, unknown> = { prompt: spec.prompt };
  if (typeof spec.seed === 'number') inp.seed = spec.seed;

  const isFlux = model.includes('flux');
  if (isFlux) {
    // Flux takes aspect_ratio (not width/height). Convert the spec's box.
    inp.aspect_ratio = nearestAspectRatio(spec.width, spec.height);
    inp.output_format = 'png';
    inp.num_outputs = 1;
    // flux-schnell uses 4 default steps; flux-dev defaults around 28.
    // We leave it on the default to match the provider's billing profile.
  } else {
    // SDXL / stable-diffusion path: use width/height + steps/guidance.
    inp.width = spec.width;
    inp.height = spec.height;
    if (spec.negativePrompt) inp.negative_prompt = spec.negativePrompt;
    inp.num_inference_steps = 25;
    inp.guidance_scale = 7.5;
  }
  return inp;
}

/**
 * Snap arbitrary width/height to one of Flux's supported aspect ratios.
 * Accepted by flux-schnell: "1:1", "16:9", "21:9", "3:2", "2:3", "4:5",
 * "5:4", "3:4", "4:3", "9:16", "9:21".
 */
function nearestAspectRatio(w: number, h: number): string {
  const candidates: Array<[string, number]> = [
    ['1:1', 1],
    ['16:9', 16 / 9],
    ['9:16', 9 / 16],
    ['3:2', 3 / 2],
    ['2:3', 2 / 3],
    ['4:3', 4 / 3],
    ['3:4', 3 / 4],
    ['4:5', 4 / 5],
    ['5:4', 5 / 4],
    ['21:9', 21 / 9],
    ['9:21', 9 / 21],
  ];
  const target = w / h;
  let best = candidates[0]!;
  let bestDiff = Math.abs(target - best[1]);
  for (const c of candidates.slice(1)) {
    const d = Math.abs(target - c[1]);
    if (d < bestDiff) {
      best = c;
      bestDiff = d;
    }
  }
  return best[0];
}

async function createPrediction(
  ctx: CallCtx,
  input: Record<string, unknown>,
): Promise<PredictionResponse> {
  const url = `${REPLICATE_API_BASE}/models/${ctx.model}/predictions`;
  const res = await ctx.fetchImpl(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ctx.apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input }),
  });
  if (!res.ok) {
    const body = await safeReadBody(res);
    throw new ProviderError({
      message: `replicate: create prediction failed (${res.status})`,
      code: res.status === 429 ? 'RATE_LIMIT' : 'CREATE_FAILED',
      provider: 'replicate',
      statusCode: res.status,
      retryable: res.status === 429 || res.status >= 500,
      body,
    });
  }
  return (await res.json()) as PredictionResponse;
}

async function pollUntilComplete(
  ctx: CallCtx,
  id: string,
  deadlineMs: number,
): Promise<unknown> {
  const url = `${REPLICATE_API_BASE}/predictions/${id}`;
  while (Date.now() < deadlineMs) {
    const res = await ctx.fetchImpl(url, {
      headers: { Authorization: `Bearer ${ctx.apiToken}` },
    });
    if (!res.ok) {
      const body = await safeReadBody(res);
      throw new ProviderError({
        message: `replicate: poll failed (${res.status})`,
        code: 'POLL_FAILED',
        provider: 'replicate',
        statusCode: res.status,
        retryable: res.status >= 500,
        body,
      });
    }
    const data = (await res.json()) as PredictionResponse;
    if (data.status === 'succeeded') return data.output;
    if (data.status === 'failed' || data.status === 'canceled') {
      throw new ProviderError({
        message: `replicate: prediction ${data.status}${data.error ? ': ' + data.error : ''}`,
        code: data.status === 'canceled' ? 'CANCELED' : 'GENERATION_FAILED',
        provider: 'replicate',
        body: data.error ?? undefined,
      });
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new ProviderError({
    message: `replicate: prediction timed out`,
    code: 'TIMEOUT',
    provider: 'replicate',
    retryable: true,
  });
}

async function download(ctx: CallCtx, url: string, deadlineMs: number): Promise<Uint8Array> {
  const budget = Math.max(1000, deadlineMs - Date.now());
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), budget);
  try {
    const res = await ctx.fetchImpl(url, { signal: ac.signal });
    if (!res.ok) {
      throw new ProviderError({
        message: `replicate: download failed (${res.status})`,
        code: 'DOWNLOAD_FAILED',
        provider: 'replicate',
        statusCode: res.status,
        retryable: res.status >= 500,
      });
    }
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  } finally {
    clearTimeout(t);
  }
}

async function safeReadBody(res: Response): Promise<string | undefined> {
  try {
    const t = await res.text();
    return t.length > 2000 ? t.slice(0, 2000) + '…' : t;
  } catch {
    return undefined;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
