/**
 * Shared helpers for `uaf create` and `uaf iterate` (Phase 7.3, 7.5).
 *
 * Ported from `scripts/run.ts` with two behavioral upgrades that bring them
 * in line with Phase 7 conventions:
 *
 *   1. The budget tracker throws a `UafError(BUDGET_EXCEEDED)` so the process
 *      exits with code 5 (RUNTIME_ERROR) instead of a plain `Error`.
 *   2. The strategy wrapper forwards `extras` (F17) so Sonnet prompt caching
 *      keeps working — the same fix that saved ~58% in Phase 6.
 */
import { readFile } from 'node:fs/promises';
import type { AgentStrategy } from '../../core/agent-factory.js';
import type { MetricRecord, Logger } from '../../core/types.js';
import type { Usage, WrapContext } from '../../core/metrics.js';
import { computeCost } from '../../core/pricing.js';
import { UafError } from '../ui/errors.js';

export class BudgetTracker {
  totalUsd = 0;
  calls = 0;
  constructor(
    readonly limitUsd: number,
    private readonly logger: Logger,
  ) {}

  preCheck(): void {
    if (this.totalUsd >= this.limitUsd) {
      throw new UafError(
        `budget exceeded: $${this.totalUsd.toFixed(4)} >= $${this.limitUsd.toFixed(2)}`,
        {
          code: 'BUDGET_EXCEEDED',
          details: { totalUsd: +this.totalUsd.toFixed(4), limitUsd: this.limitUsd },
          hint: 'Raise --budget-usd or relax per-role models in ~/.uaf/config.yaml.',
        },
      );
    }
  }

  record(model: string, usage: Usage): void {
    const cost = computeCost(model, usage);
    this.totalUsd += cost;
    this.calls += 1;
    this.logger.info('budget.tick', {
      call: this.calls,
      model,
      in: usage.inputTokens ?? 0,
      out: usage.outputTokens ?? 0,
      cacheR: usage.cacheReadTokens ?? 0,
      cacheW: usage.cacheCreationTokens ?? 0,
      callUsd: +cost.toFixed(5),
      totalUsd: +this.totalUsd.toFixed(5),
      limitUsd: this.limitUsd,
    });
  }
}

export function budgetedStrategy(inner: AgentStrategy, tracker: BudgetTracker): AgentStrategy {
  return {
    async run(role, input, sp, tools, ctx, extras) {
      tracker.preCheck();
      const spy: WrapContext = {
        usage: (u) => {
          tracker.record(u.model ?? 'unknown', u);
          ctx.usage(u);
        },
      };
      // F17: forward extras or Sonnet prompt caching silently breaks.
      return inner.run(role, input, sp, tools, spy, extras);
    },
  };
}

// ---------------------------------------------------------------------------
// Metrics summarization (used for the final stdout summary)
// ---------------------------------------------------------------------------

export interface MetricsSummary {
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  totalDurationMs: number;
  totalUsd: number;
  byRole: Record<string, { calls: number; inUsd: number }>;
}

function emptySummary(): MetricsSummary {
  return {
    totalCalls: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheReadTokens: 0,
    totalCacheWriteTokens: 0,
    totalDurationMs: 0,
    totalUsd: 0,
    byRole: {},
  };
}

export async function summarizeMetrics(path: string, fallbackModel: string): Promise<MetricsSummary> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return emptySummary();
  }
  const s = emptySummary();
  for (const line of raw.split('\n').filter(Boolean)) {
    const rec = JSON.parse(line) as MetricRecord;
    const model = rec.model && rec.model !== 'n/a' ? rec.model : fallbackModel;
    const cost = computeCost(model, {
      inputTokens: rec.inputTokens,
      outputTokens: rec.outputTokens,
      cacheReadTokens: rec.cacheReadTokens,
      cacheCreationTokens: rec.cacheCreationTokens,
    });
    s.totalCalls += 1;
    s.totalInputTokens += rec.inputTokens;
    s.totalOutputTokens += rec.outputTokens;
    s.totalCacheReadTokens += rec.cacheReadTokens ?? 0;
    s.totalCacheWriteTokens += rec.cacheCreationTokens ?? 0;
    s.totalDurationMs += rec.durationMs;
    s.totalUsd += cost;
    const bucket = s.byRole[rec.role] ?? { calls: 0, inUsd: 0 };
    bucket.calls += 1;
    bucket.inUsd += cost;
    s.byRole[rec.role] = bucket;
  }
  return s;
}

// ---------------------------------------------------------------------------
// Run summary formatter — stdout-friendly, mirrors the Phase 6 format.
// ---------------------------------------------------------------------------

export interface RunSummaryInput {
  request: string;
  recipe: string;
  projectId?: string;
  workspaceDir?: string;
  metricsPath?: string;
  elapsedSec: number;
  reportOk: boolean;
  haltReason?: string;
  doneFlag: boolean;
  overall: number;
  toolStats: {
    total: number;
    byTool: Map<string, { calls: number; fails: number }>;
  };
  summary?: MetricsSummary;
  budgetUsd: number;
}

export function formatRunSummary(x: RunSummaryInput): string {
  const out: string[] = [];
  out.push('');
  out.push('=== UAF run summary ===');
  out.push(`request       : ${x.request}`);
  out.push(`recipe        : ${x.recipe}`);
  out.push(`projectId     : ${x.projectId ?? '(n/a)'}`);
  out.push(`workspace     : ${x.workspaceDir ?? '(n/a)'}`);
  out.push(`metrics.jsonl : ${x.metricsPath ?? '(n/a)'}`);
  out.push(`elapsed       : ${x.elapsedSec}s`);
  out.push(`finished      : ${x.reportOk ? 'yes' : 'no (threw)'}`);
  out.push(`halted        : ${x.haltReason ? `yes — ${x.haltReason}` : 'no'}`);
  out.push(`completion    : done=${x.doneFlag} overall=${x.overall}/100`);
  if (x.summary) {
    out.push(`llm calls     : ${x.summary.totalCalls}`);
    out.push(`tool calls    : ${x.toolStats.total}`);
    if (x.toolStats.total > 0) {
      const breakdown = [...x.toolStats.byTool.entries()]
        .map(([name, v]) => `${name}=${v.calls}${v.fails ? `(${v.fails}✗)` : ''}`)
        .join(' ');
      out.push(`tool breakdown: ${breakdown}`);
    }
    out.push(
      `tokens        : in=${x.summary.totalInputTokens} out=${x.summary.totalOutputTokens} cacheR=${x.summary.totalCacheReadTokens} cacheW=${x.summary.totalCacheWriteTokens}`,
    );
    out.push(`duration (llm): ${Math.round(x.summary.totalDurationMs / 1000)}s`);
    out.push(
      `cost          : $${x.summary.totalUsd.toFixed(4)} (budget $${x.budgetUsd.toFixed(2)})`,
    );
    out.push(`per role      :`);
    for (const [role, v] of Object.entries(x.summary.byRole)) {
      out.push(`  - ${role.padEnd(12)} ${v.calls.toString().padStart(2)}x  $${v.inUsd.toFixed(4)}`);
    }
  }
  out.push('');
  return out.join('\n');
}
