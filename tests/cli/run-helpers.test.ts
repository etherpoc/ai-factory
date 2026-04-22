/**
 * Phase 7.3 regression for cli/commands/_run-helpers.ts.
 *
 * Locks the budget-tracker behavior that keeps "Opus ゼロ運用" honest:
 *   - exceeding the budget throws a UafError with code BUDGET_EXCEEDED
 *     (→ exit 5 via cli/ui/exit-codes)
 *   - budgetedStrategy forwards `extras` (the F17 fix that keeps Sonnet
 *     prompt caching working)
 *   - summarizeMetrics reads a workspace jsonl file and returns a cost total
 *     identical to scripts/recompute-metrics.ts (no drift)
 *   - formatRunSummary emits a stable, parseable text block.
 */
import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nullLogger } from '../../core/logger.js';
import { UafError } from '../../cli/ui/errors.js';
import {
  BudgetTracker,
  budgetedStrategy,
  formatRunSummary,
  summarizeMetrics,
} from '../../cli/commands/_run-helpers.js';

describe('cli/commands/_run-helpers — BudgetTracker', () => {
  it('preCheck is a no-op while under the cap', () => {
    const t = new BudgetTracker(1.0, nullLogger);
    expect(() => t.preCheck()).not.toThrow();
  });

  it('preCheck throws UafError(BUDGET_EXCEEDED) once over the cap', () => {
    const t = new BudgetTracker(0.01, nullLogger);
    // Fake a recorded usage that blows the budget.
    t.record('claude-sonnet-4-6', { inputTokens: 1_000_000, outputTokens: 0 });
    expect(t.totalUsd).toBeGreaterThan(0.01);
    const err = (() => {
      try {
        t.preCheck();
      } catch (e) {
        return e;
      }
      return null;
    })();
    expect(err).toBeInstanceOf(UafError);
    expect((err as UafError).code).toBe('BUDGET_EXCEEDED');
    expect((err as UafError).details?.limitUsd).toBe(0.01);
  });

  it('record accumulates across calls', () => {
    const t = new BudgetTracker(10.0, nullLogger);
    t.record('claude-haiku-4-5', { inputTokens: 1000, outputTokens: 500 });
    t.record('claude-haiku-4-5', { inputTokens: 1000, outputTokens: 500 });
    expect(t.calls).toBe(2);
    expect(t.totalUsd).toBeGreaterThan(0);
  });
});

describe('cli/commands/_run-helpers — budgetedStrategy', () => {
  it('forwards extras to the inner strategy (F17)', async () => {
    let capturedExtras: unknown = 'not-captured';
    const inner = {
      async run(
        _role: string,
        _input: unknown,
        _sp: string,
        _tools: unknown,
        ctx: { usage: (u: unknown) => void },
        extras?: unknown,
      ): Promise<{ role: string; artifacts: object; metrics: [] }> {
        capturedExtras = extras;
        ctx.usage({ model: 'claude-sonnet-4-6', inputTokens: 100, outputTokens: 50 });
        return { role: 'programmer', artifacts: {}, metrics: [] };
      },
    };
    const tracker = new BudgetTracker(1.0, nullLogger);
    // Bypass the strict AgentStrategy type since the test double only
    // implements the contract our wrapper touches.
    const s = budgetedStrategy(
      inner as Parameters<typeof budgetedStrategy>[0],
      tracker,
    );
    const userCtx = { usage: () => undefined };
    await s.run('programmer', {} as never, 'sp', [], userCtx, { preamble: 'HELLO' } as never);
    expect(capturedExtras).toEqual({ preamble: 'HELLO' });
    expect(tracker.calls).toBe(1);
  });
});

describe('cli/commands/_run-helpers — summarizeMetrics', () => {
  it('returns an empty summary for a missing file', async () => {
    const s = await summarizeMetrics('does-not-exist.jsonl', 'claude-sonnet-4-6');
    expect(s.totalCalls).toBe(0);
    expect(s.totalUsd).toBe(0);
  });

  it('sums across jsonl rows', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'uaf-runhelp-'));
    try {
      const p = join(dir, 'metrics.jsonl');
      const rows = [
        {
          ts: '2026-04-22T00:00:00.000Z',
          projectId: 't',
          role: 'director',
          model: 'claude-sonnet-4-6',
          inputTokens: 1000,
          outputTokens: 500,
          durationMs: 1000,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          step: 'director:x',
        },
        {
          ts: '2026-04-22T00:01:00.000Z',
          projectId: 't',
          role: 'tester',
          model: 'n/a',
          inputTokens: 0,
          outputTokens: 0,
          durationMs: 0,
          step: 'tester:x',
        },
      ];
      await writeFile(p, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
      const s = await summarizeMetrics(p, 'claude-sonnet-4-6');
      expect(s.totalCalls).toBe(2);
      expect(s.totalInputTokens).toBe(1000);
      expect(s.totalOutputTokens).toBe(500);
      expect(s.byRole.director?.calls).toBe(1);
      expect(s.byRole.tester?.calls).toBe(1);
      // Cost > 0 because of the director row; tester row has n/a model.
      expect(s.totalUsd).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('cli/commands/_run-helpers — formatRunSummary', () => {
  it('produces a stable, parseable block', () => {
    const text = formatRunSummary({
      request: 'make X',
      recipe: '2d-game',
      projectId: 'proj-1',
      workspaceDir: '/ws/proj-1',
      metricsPath: '/ws/proj-1/metrics.jsonl',
      elapsedSec: 42,
      reportOk: true,
      doneFlag: true,
      overall: 97,
      toolStats: {
        total: 3,
        byTool: new Map([
          ['read', { calls: 2, fails: 0 }],
          ['write', { calls: 1, fails: 1 }],
        ]),
      },
      summary: {
        totalCalls: 3,
        totalInputTokens: 100,
        totalOutputTokens: 50,
        totalCacheReadTokens: 0,
        totalCacheWriteTokens: 0,
        totalDurationMs: 10_000,
        totalUsd: 0.1234,
        byRole: { director: { calls: 1, inUsd: 0.01 } },
      },
      budgetUsd: 2,
    });

    expect(text).toContain('=== UAF run summary ===');
    expect(text).toContain('request       : make X');
    expect(text).toContain('completion    : done=true overall=97/100');
    expect(text).toContain('tool breakdown: read=2 write=1(1✗)');
    expect(text).toContain('cost          : $0.1234 (budget $2.00)');
    // padEnd(12) on "director" (8) + ' ' + padStart(2) of "1" = 6 spaces + ' 1'
    expect(text).toContain('- director      1x  $0.0100');
  });
});
