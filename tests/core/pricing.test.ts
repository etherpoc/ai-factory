import { describe, expect, it } from 'vitest';
import { PRICING, computeCost, lookupPricing } from '../../core/pricing';

describe('pricing (F14 corrected table)', () => {
  it('Opus 4.7 is $5 / $25 per MTok (not the old $15 / $75)', () => {
    const p = PRICING['claude-opus-4-7']!;
    expect(p.input).toBe(5);
    expect(p.output).toBe(25);
    expect(p.cacheRead).toBe(0.5);
    expect(p.cacheWrite5m).toBe(6.25);
    expect(p.cacheWrite1h).toBe(10);
  });

  it('Sonnet 4.6 is $3 / $15', () => {
    const p = PRICING['claude-sonnet-4-6']!;
    expect(p.input).toBe(3);
    expect(p.output).toBe(15);
  });

  it('Haiku 4.5 is $1 / $5', () => {
    const p = PRICING['claude-haiku-4-5']!;
    expect(p.input).toBe(1);
    expect(p.output).toBe(5);
  });

  it('lookupPricing strips dated suffixes (claude-haiku-4-5-20251001 → haiku 4.5)', () => {
    const dated = lookupPricing('claude-haiku-4-5-20251001');
    expect(dated.input).toBe(1);
  });

  it('lookupPricing falls back to Sonnet for unknown models', () => {
    const unknown = lookupPricing('some-future-model-id');
    expect(unknown.input).toBe(3);
  });

  it('computeCost matches Console math for Opus 4.7', () => {
    // 266,373 input + 16,268 cache_read + 42,251 output
    // = 266373*5e-6 + 16268*0.5e-6 + 42251*25e-6
    // = 1.331865 + 0.008134 + 1.056275 = $2.396274 ≈ $2.40 (matches user's console)
    const cost = computeCost('claude-opus-4-7', {
      inputTokens: 266_373,
      outputTokens: 42_251,
      cacheReadTokens: 16_268,
    });
    expect(cost).toBeCloseTo(2.396, 2);
  });

  it('computeCost treats cacheCreationTokens (aggregate) as 5m rate when finer fields are absent', () => {
    const cost = computeCost('claude-opus-4-7', {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 1_000_000,
    });
    expect(cost).toBe(6.25);
  });

  it('computeCost uses the finer 1h split when provided', () => {
    const cost = computeCost('claude-opus-4-7', {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreation5mTokens: 0,
      cacheCreation1hTokens: 1_000_000,
    });
    expect(cost).toBe(10);
  });
});
