/**
 * Recompute USD cost for one or more metrics.jsonl files using the current
 * core/pricing.ts table. Usage:
 *
 *   pnpm tsx scripts/recompute-metrics.ts <path...>
 *
 * Prints a summary per file (tokens, cost) and totals across all.
 */
import { readFile } from 'node:fs/promises';
import type { MetricRecord } from '../core/types.js';
import { computeCost } from '../core/pricing.js';

interface Totals {
  calls: number;
  input: number;
  output: number;
  cacheR: number;
  cacheW: number;
  cost: number;
  byModel: Record<string, { calls: number; cost: number }>;
  byRole: Record<string, { calls: number; cost: number }>;
}

function emptyTotals(): Totals {
  return { calls: 0, input: 0, output: 0, cacheR: 0, cacheW: 0, cost: 0, byModel: {}, byRole: {} };
}

function add(into: Totals, rec: MetricRecord, cost: number): void {
  into.calls += 1;
  into.input += rec.inputTokens;
  into.output += rec.outputTokens;
  into.cacheR += rec.cacheReadTokens ?? 0;
  into.cacheW += rec.cacheCreationTokens ?? 0;
  into.cost += cost;
  const m = into.byModel[rec.model] ?? { calls: 0, cost: 0 };
  m.calls += 1;
  m.cost += cost;
  into.byModel[rec.model] = m;
  const r = into.byRole[rec.role] ?? { calls: 0, cost: 0 };
  r.calls += 1;
  r.cost += cost;
  into.byRole[rec.role] = r;
}

async function main(): Promise<number> {
  const paths = process.argv.slice(2);
  if (paths.length === 0) {
    process.stderr.write('Usage: pnpm tsx scripts/recompute-metrics.ts <metrics.jsonl>...\n');
    return 2;
  }
  const grand = emptyTotals();
  for (const p of paths) {
    const raw = await readFile(p, 'utf8');
    const per = emptyTotals();
    for (const line of raw.split('\n').filter(Boolean)) {
      const rec = JSON.parse(line) as MetricRecord;
      const cost = computeCost(rec.model, {
        inputTokens: rec.inputTokens,
        outputTokens: rec.outputTokens,
        cacheReadTokens: rec.cacheReadTokens,
        cacheCreationTokens: rec.cacheCreationTokens,
      });
      add(per, rec, cost);
      add(grand, rec, cost);
    }
    process.stdout.write(
      `\n[${p}]\n` +
        `  calls: ${per.calls}\n` +
        `  tokens: in=${per.input} out=${per.output} cacheR=${per.cacheR} cacheW=${per.cacheW}\n` +
        `  cost: $${per.cost.toFixed(4)}\n` +
        `  by model: ${summarizeMap(per.byModel)}\n` +
        `  by role:  ${summarizeMap(per.byRole)}\n`,
    );
  }
  if (paths.length > 1) {
    process.stdout.write(
      `\n=== Totals across ${paths.length} files ===\n` +
        `  calls: ${grand.calls}\n` +
        `  tokens: in=${grand.input} out=${grand.output} cacheR=${grand.cacheR} cacheW=${grand.cacheW}\n` +
        `  cost: $${grand.cost.toFixed(4)}\n`,
    );
  }
  return 0;
}

function summarizeMap(m: Record<string, { calls: number; cost: number }>): string {
  return Object.entries(m)
    .map(([k, v]) => `${k}=${v.calls}× ($${v.cost.toFixed(4)})`)
    .join(', ');
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exit(1);
  },
);
