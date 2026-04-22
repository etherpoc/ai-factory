/**
 * Per-model pricing (USD per million tokens). Keep this the **single source**
 * so scripts/run.ts, metrics summaries, and any cost-aware logic agree.
 *
 * Pricing reference (2026-04, Anthropic Console):
 *   - Opus 4.7: $5 / $25 (input / output)
 *   - Sonnet 4.6: $3 / $15
 *   - Haiku 4.5: $1 / $5
 *   - cache_read  = input × 0.1
 *   - cache_write (ephemeral 5m) = input × 1.25
 *   - cache_write (ephemeral 1h) = input × 2.0
 *
 * NOTE: Earlier versions of this project shipped with a stale table that used
 * Opus 4.0/4.1 pricing ($15 / $75). See FINDINGS.md F14.
 */

export interface Pricing {
  input: number;
  output: number;
  cacheRead: number;
  /** Ephemeral 5-minute cache write rate (the default cache_control: type=ephemeral). */
  cacheWrite5m: number;
  /** Ephemeral 1-hour cache write rate. */
  cacheWrite1h: number;
}

/**
 * Canonical pricing per model. Keys are the canonical model IDs passed to the
 * Anthropic API. Dated variants (`claude-haiku-4-5-20251001`) collapse to the
 * dateless entry via `lookupPricing`.
 */
export const PRICING: Record<string, Pricing> = {
  'claude-opus-4-7': { input: 5, output: 25, cacheRead: 0.5, cacheWrite5m: 6.25, cacheWrite1h: 10 },
  'claude-opus-4-6': { input: 5, output: 25, cacheRead: 0.5, cacheWrite5m: 6.25, cacheWrite1h: 10 },
  'claude-sonnet-4-6': {
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheWrite5m: 3.75,
    cacheWrite1h: 6,
  },
  'claude-haiku-4-5': {
    input: 1,
    output: 5,
    cacheRead: 0.1,
    cacheWrite5m: 1.25,
    cacheWrite1h: 2,
  },
};

const FALLBACK: Pricing = PRICING['claude-sonnet-4-6']!;

/**
 * Resolve pricing for a model id. Dated suffixes (e.g. `-20251001`) and
 * unknown ids fall back to Sonnet rates to avoid wild under/over estimates.
 */
export function lookupPricing(model: string): Pricing {
  if (PRICING[model]) return PRICING[model];
  // strip common date suffix: -YYYYMMDD
  const dateless = model.replace(/-\d{8}$/, '');
  if (PRICING[dateless]) return PRICING[dateless];
  return FALLBACK;
}

export interface UsageLike {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  /** Optional: if provided, split cache_creation into 5m vs 1h. If omitted, treat all as 5m (ephemeral default). */
  cacheCreation5mTokens?: number;
  cacheCreation1hTokens?: number;
}

/** Compute USD cost for a single API call's usage, given a model id. */
export function computeCost(model: string, usage: UsageLike): number {
  const p = lookupPricing(model);
  const mtok = (n: number | undefined) => (n ?? 0) / 1_000_000;
  const write5m = mtok(usage.cacheCreation5mTokens);
  const write1h = mtok(usage.cacheCreation1hTokens);
  // If the caller only gave us the aggregate, attribute it entirely to the
  // default ephemeral 5m tier.
  const fallbackCreation =
    usage.cacheCreation5mTokens === undefined && usage.cacheCreation1hTokens === undefined
      ? mtok(usage.cacheCreationTokens)
      : 0;

  return (
    mtok(usage.inputTokens) * p.input +
    mtok(usage.outputTokens) * p.output +
    mtok(usage.cacheReadTokens) * p.cacheRead +
    write5m * p.cacheWrite5m +
    write1h * p.cacheWrite1h +
    fallbackCreation * p.cacheWrite5m
  );
}
