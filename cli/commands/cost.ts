/**
 * `uaf cost` — aggregate LLM cost across all workspaces.
 *
 * Reads every `workspace/<proj>/metrics.jsonl`, recomputes cost with
 * `core/pricing.ts`, and prints a roll-up. `--period` filters rows by
 * timestamp (today / week / month / all).
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { MetricRecord } from '../../core/types.js';
import { computeCost } from '../../core/pricing.js';
import { loadEffectiveConfig, resolveWorkspaceDir } from '../config/loader.js';
import { readWorkspaceState } from '../utils/workspace.js';
import { colors } from '../ui/colors.js';

export interface CostOptions {
  period?: 'today' | 'week' | 'month' | 'all' | string;
  json?: boolean;
}

interface Bucket {
  calls: number;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheWrite: number;
}
function emptyBucket(): Bucket {
  return { calls: 0, cost: 0, inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0 };
}
function addInto(b: Bucket, rec: MetricRecord, cost: number): void {
  b.calls += 1;
  b.cost += cost;
  b.inputTokens += rec.inputTokens;
  b.outputTokens += rec.outputTokens;
  b.cacheRead += rec.cacheReadTokens ?? 0;
  b.cacheWrite += rec.cacheCreationTokens ?? 0;
}

function periodCutoffMs(period: string): number {
  const now = Date.now();
  switch (period) {
    case 'today': {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    }
    case 'week':
      return now - 7 * 24 * 60 * 60_000;
    case 'month':
      return now - 30 * 24 * 60 * 60_000;
    case 'all':
    default:
      return 0;
  }
}

export async function runCost(opts: CostOptions = {}, _global: unknown = {}): Promise<void> {
  const { effective: cfg } = await loadEffectiveConfig();
  const workspaceBase = resolveWorkspaceDir(cfg, process.cwd());
  const period = opts.period ?? 'all';
  const cutoff = periodCutoffMs(period);

  const total = emptyBucket();
  const byModel = new Map<string, Bucket>();
  const byRole = new Map<string, Bucket>();
  const byProject = new Map<string, Bucket>();
  let opusCalls = 0;

  // Phase 11.a: external provider spend (Replicate, ElevenLabs). Populated
  // by `uaf create` in state.json.assets; falls back to manifest parsing
  // when state.json is absent.
  const assetSpend = {
    imagesCostUsd: 0,
    imagesCount: 0,
    audioCostUsd: 0,
    audioCount: 0,
    byProvider: new Map<string, number>(),
  };

  let projects: string[];
  try {
    projects = await readdir(workspaceBase);
  } catch {
    projects = [];
  }

  for (const name of projects) {
    if (name.startsWith('.')) continue;
    const dir = join(workspaceBase, name);
    try {
      const info = await stat(dir);
      if (!info.isDirectory()) continue;
    } catch {
      continue;
    }
    const path = join(dir, 'metrics.jsonl');
    let raw: string;
    try {
      raw = await readFile(path, 'utf8');
    } catch {
      continue;
    }
    for (const line of raw.split('\n').filter(Boolean)) {
      let rec: MetricRecord;
      try {
        rec = JSON.parse(line) as MetricRecord;
      } catch {
        continue;
      }
      const ts = Date.parse(rec.ts);
      if (Number.isFinite(ts) && ts < cutoff) continue;
      const cost = computeCost(rec.model, {
        inputTokens: rec.inputTokens,
        outputTokens: rec.outputTokens,
        cacheReadTokens: rec.cacheReadTokens,
        cacheCreationTokens: rec.cacheCreationTokens,
      });
      addInto(total, rec, cost);
      addInto(upsert(byModel, rec.model), rec, cost);
      addInto(upsert(byRole, rec.role), rec, cost);
      addInto(upsert(byProject, rec.projectId), rec, cost);
      if (/^claude-opus/.test(rec.model)) opusCalls += 1;
    }

    // Phase 11.a: fold state.json asset spend (bucketed per project but
    // not time-filtered — assets are a whole-project output, so the
    // period filter's granularity is the project itself via lastRunAt).
    const state = await readWorkspaceState(dir).catch(() => null);
    if (state && state.assets) {
      const stateTs = Date.parse(state.lastRunAt);
      if (!Number.isFinite(stateTs) || stateTs >= cutoff) {
        if (state.assets.images) {
          assetSpend.imagesCostUsd += state.assets.images.totalCostUsd ?? 0;
          assetSpend.imagesCount += state.assets.images.count ?? 0;
        }
        if (state.assets.audio) {
          assetSpend.audioCostUsd += state.assets.audio.totalCostUsd ?? 0;
          assetSpend.audioCount += state.assets.audio.count ?? 0;
        }
      }
    }
  }

  if (assetSpend.imagesCostUsd > 0) assetSpend.byProvider.set('replicate', assetSpend.imagesCostUsd);
  if (assetSpend.audioCostUsd > 0) assetSpend.byProvider.set('elevenlabs', assetSpend.audioCostUsd);

  if (opts.json) {
    process.stdout.write(
      JSON.stringify(
        {
          period,
          cutoffMs: cutoff,
          workspaceBase,
          total,
          byModel: Object.fromEntries(byModel),
          byRole: Object.fromEntries(byRole),
          byProject: Object.fromEntries(byProject),
          opusCalls,
          assets: {
            imagesCostUsd: assetSpend.imagesCostUsd,
            imagesCount: assetSpend.imagesCount,
            audioCostUsd: assetSpend.audioCostUsd,
            audioCount: assetSpend.audioCount,
            byProvider: Object.fromEntries(assetSpend.byProvider),
          },
          grandTotalUsd:
            total.cost + assetSpend.imagesCostUsd + assetSpend.audioCostUsd,
        },
        null,
        2,
      ) + '\n',
    );
    return;
  }

  const out: string[] = [];
  out.push(colors.bold(`=== uaf cost (${period}) ===`));
  out.push(`workspace   : ${workspaceBase}`);
  out.push(`calls total : ${total.calls}`);
  out.push(
    `tokens      : in=${total.inputTokens} out=${total.outputTokens} cacheR=${total.cacheRead} cacheW=${total.cacheWrite}`,
  );
  out.push(colors.bold(`cost total  : $${total.cost.toFixed(4)}`));
  out.push(
    opusCalls === 0
      ? colors.green(`opus usage  : 0 calls (F18 zero-Opus policy maintained)`)
      : colors.yellow(`opus usage  : ${opusCalls} calls — investigate`),
  );
  out.push('');
  out.push('by model:');
  for (const [k, v] of [...byModel].sort((a, b) => b[1].cost - a[1].cost)) {
    out.push(`  ${k.padEnd(24)} ${v.calls.toString().padStart(4)}x  $${v.cost.toFixed(4)}`);
  }
  out.push('');
  out.push('by role:');
  for (const [k, v] of [...byRole].sort((a, b) => b[1].cost - a[1].cost)) {
    out.push(`  ${k.padEnd(14)} ${v.calls.toString().padStart(4)}x  $${v.cost.toFixed(4)}`);
  }
  if (byProject.size > 0) {
    out.push('');
    out.push(`top projects (${Math.min(byProject.size, 10)} of ${byProject.size}):`);
    const top = [...byProject].sort((a, b) => b[1].cost - a[1].cost).slice(0, 10);
    for (const [k, v] of top) {
      out.push(`  ${k.padEnd(48)} $${v.cost.toFixed(4)}`);
    }
  }

  // Phase 11.a: asset generation spend.
  const anyAssetSpend =
    assetSpend.imagesCostUsd > 0 || assetSpend.audioCostUsd > 0 || assetSpend.imagesCount > 0 || assetSpend.audioCount > 0;
  if (anyAssetSpend) {
    out.push('');
    out.push('asset generation (external providers):');
    if (assetSpend.imagesCount > 0 || assetSpend.imagesCostUsd > 0) {
      out.push(
        `  replicate   ${assetSpend.imagesCount.toString().padStart(4)} images   $${assetSpend.imagesCostUsd.toFixed(4)}`,
      );
    }
    if (assetSpend.audioCount > 0 || assetSpend.audioCostUsd > 0) {
      out.push(
        `  elevenlabs  ${assetSpend.audioCount.toString().padStart(4)} clips    $${assetSpend.audioCostUsd.toFixed(4)}`,
      );
    }
    const assetTotal = assetSpend.imagesCostUsd + assetSpend.audioCostUsd;
    const grandTotal = total.cost + assetTotal;
    out.push('');
    out.push(colors.bold(`grand total : $${grandTotal.toFixed(4)}  (LLM $${total.cost.toFixed(4)} + assets $${assetTotal.toFixed(4)})`));
  }

  // Disclaimer per Phase 7.6 — this aggregates what's on disk, not what
  // the provider billing systems actually charged.
  out.push('');
  out.push(
    colors.dim(
      'note: aggregates existing workspace metrics only. For LLM true billing see console.anthropic.com; for asset billing see replicate.com / elevenlabs.io.',
    ),
  );
  process.stdout.write(out.join('\n') + '\n');
}

function upsert(map: Map<string, Bucket>, key: string): Bucket {
  let b = map.get(key);
  if (!b) {
    b = emptyBucket();
    map.set(key, b);
  }
  return b;
}
