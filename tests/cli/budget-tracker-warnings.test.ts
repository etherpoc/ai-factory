/**
 * Phase 7.8.11 — BudgetTracker threshold warnings + halt-hint tests.
 */
import { describe, expect, it } from 'vitest';
import { BudgetTracker, type BudgetWarnEvent } from '../../cli/commands/_run-helpers';
import { nullLogger } from '../../core/logger';
import { UafError } from '../../cli/ui/errors';

// Cache-read-only usage so computeCost returns a predictable number. Sonnet
// cache-read = $0.30 per 1M tokens → 1000 cacheRead tokens = $0.0003.
// We use inputTokens instead for clearer numbers: sonnet input = $3/M.
// 100k input tokens = $0.30. Two calls = $0.60 (80% of $0.75).
const sonnet = 'claude-sonnet-4-6';

describe('BudgetTracker — threshold warnings', () => {
  it('fires once each at 50% and 80% as cumulative cost crosses them', () => {
    const warnings: BudgetWarnEvent[] = [];
    const tracker = new BudgetTracker(1.0, nullLogger, {
      onWarn: (ev) => warnings.push(ev),
    });
    // 100k input tokens = $0.30 → 30% of $1.00 (no warning yet)
    tracker.record(sonnet, { inputTokens: 100_000, outputTokens: 0 });
    expect(warnings.length).toBe(0);
    // +100k → $0.60 (60% — crosses 50%)
    tracker.record(sonnet, { inputTokens: 100_000, outputTokens: 0 });
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toMatchObject({ thresholdPct: 50 });
    // +100k → $0.90 (crosses 80%)
    tracker.record(sonnet, { inputTokens: 100_000, outputTokens: 0 });
    expect(warnings.length).toBe(2);
    expect(warnings[1]).toMatchObject({ thresholdPct: 80 });
  });

  it('does not fire the same threshold twice even if spending continues', () => {
    const warnings: BudgetWarnEvent[] = [];
    const tracker = new BudgetTracker(1.0, nullLogger, {
      onWarn: (ev) => warnings.push(ev),
    });
    // Jump straight past 80% with one call (300k → $0.90)
    tracker.record(sonnet, { inputTokens: 300_000, outputTokens: 0 });
    // Both 50 and 80 fire on this single transition.
    expect(warnings.map((w) => w.thresholdPct).sort()).toEqual([50, 80]);
    // Further calls don't re-fire.
    tracker.record(sonnet, { inputTokens: 100_000, outputTokens: 0 });
    expect(warnings.length).toBe(2);
  });

  it('respects custom thresholds', () => {
    const warnings: BudgetWarnEvent[] = [];
    const tracker = new BudgetTracker(1.0, nullLogger, {
      warnThresholdsPct: [25, 75],
      onWarn: (ev) => warnings.push(ev),
    });
    tracker.record(sonnet, { inputTokens: 100_000, outputTokens: 0 }); // 30%
    tracker.record(sonnet, { inputTokens: 200_000, outputTokens: 0 }); // 90%
    expect(warnings.map((w) => w.thresholdPct)).toEqual([25, 75]);
  });

  it('includes recipeSuggestedUsd in the warn event when provided', () => {
    const warnings: BudgetWarnEvent[] = [];
    const tracker = new BudgetTracker(1.0, nullLogger, {
      recipeSuggestedUsd: 3.5,
      onWarn: (ev) => warnings.push(ev),
    });
    tracker.record(sonnet, { inputTokens: 200_000, outputTokens: 0 }); // 60%
    expect(warnings[0]).toMatchObject({ thresholdPct: 50, recipeSuggestedUsd: 3.5 });
  });

  it('limit=0 never fires warnings (no divide-by-zero)', () => {
    const warnings: BudgetWarnEvent[] = [];
    const tracker = new BudgetTracker(0, nullLogger, {
      onWarn: (ev) => warnings.push(ev),
    });
    tracker.record(sonnet, { inputTokens: 100_000, outputTokens: 0 });
    expect(warnings.length).toBe(0);
  });
});

describe('BudgetTracker — halt hint', () => {
  it('suggests the recipe default + a padded retry budget when exceeded', () => {
    const tracker = new BudgetTracker(0.5, nullLogger, { recipeSuggestedUsd: 3.5 });
    // Push over limit
    tracker.record(sonnet, { inputTokens: 250_000, outputTokens: 0 }); // $0.75
    try {
      tracker.preCheck();
      throw new Error('expected UafError but preCheck did not throw');
    } catch (err) {
      expect(err).toBeInstanceOf(UafError);
      const uaf = err as UafError;
      expect(uaf.code).toBe('BUDGET_EXCEEDED');
      expect(uaf.hint).toContain('--budget-usd');
      expect(uaf.hint).toContain('3.50'); // recipe default surfaced
      // Padded retry budget >= recipe default AND >= 2.4x overshoot
      const details = uaf.details as { suggestedNextUsd?: number };
      expect(details.suggestedNextUsd).toBeGreaterThanOrEqual(3.5);
    }
  });

  it('falls back to the plain hint when no recipe suggestion is present', () => {
    const tracker = new BudgetTracker(0.5, nullLogger);
    tracker.record(sonnet, { inputTokens: 250_000, outputTokens: 0 });
    try {
      tracker.preCheck();
      throw new Error('expected UafError');
    } catch (err) {
      const uaf = err as UafError;
      expect(uaf.code).toBe('BUDGET_EXCEEDED');
      expect(uaf.hint).toContain('--budget-usd');
      expect(uaf.hint).not.toContain('recipe default');
    }
  });
});
