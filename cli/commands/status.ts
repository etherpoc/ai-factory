/**
 * `uaf status <proj-id>` (Phase 7.8.4).
 *
 * Pretty-prints state.json: phase, progress, per-task status, accumulated
 * cost. Read-only — no LLM calls, no side effects.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MetricRecord } from '../../core/types.js';
import { computeCost } from '../../core/pricing.js';
import { isLegacyState } from '../../core/state.js';
import { loadEffectiveConfig, resolveWorkspaceDir } from '../config/loader.js';
import { colors } from '../ui/colors.js';
import { formatDuration } from '../utils/duration.js';
import { findProject } from '../utils/workspace.js';

export interface StatusOptions {
  json?: boolean;
}

export async function runStatus(
  args: { projectId: string },
  opts: StatusOptions = {},
  _global: unknown = {},
): Promise<void> {
  const { effective: cfg } = await loadEffectiveConfig();
  const workspaceBase = resolveWorkspaceDir(cfg, process.cwd());
  const project = await findProject(workspaceBase, args.projectId);
  const state = project.state;
  const cost = await readTotalCost(project.dir);

  if (opts.json) {
    process.stdout.write(JSON.stringify({ project: { ...project, state, cost } }, null, 2) + '\n');
    return;
  }

  if (!state) {
    process.stderr.write(
      colors.dim('No state.json — this workspace predates Phase 7.5.\n'),
    );
    process.stdout.write(`Project: ${project.projectId}\n`);
    process.stdout.write(`Workspace: ${project.dir}\n`);
    return;
  }

  const lines: string[] = [];
  lines.push(colors.bold(`=== uaf status — ${project.projectId} ===`));
  lines.push(`Workspace : ${project.dir}`);
  lines.push(`Recipe    : ${state.recipeType}`);
  lines.push(`Request   : ${truncate(state.originalRequest, 80)}`);
  lines.push(`Created   : ${state.createdAt}`);
  lines.push(`Last run  : ${state.lastRunAt}  (${formatDuration(Date.now() - Date.parse(state.lastRunAt))} ago)`);
  lines.push(`Status    : ${colorStatus(state.status)}`);
  if (state.phase) {
    lines.push(`Phase     : ${colorPhase(state.phase)}`);
  } else {
    lines.push(colors.dim('Phase     : (legacy — pre-Phase 7.8 workspace)'));
  }
  if (state.resumable !== undefined) {
    lines.push(`Resumable : ${state.resumable ? colors.green('yes') : colors.dim('no')}`);
  }
  lines.push(`LLM cost  : $${cost.toFixed(4)}`);

  if (state.spec) {
    lines.push('');
    lines.push(colors.bold('Spec'));
    lines.push(`  path: ${state.spec.path}`);
    lines.push(`  dialogTurns: ${state.spec.dialogTurns}`);
    lines.push(`  approved: ${state.spec.userApproved ? 'yes' : 'no'}`);
  }

  if (state.roadmap) {
    const rm = state.roadmap;
    lines.push('');
    lines.push(
      colors.bold(
        `Roadmap (${rm.completedTasks}/${rm.totalTasks} done` +
          (rm.estimatedCostUsd !== undefined
            ? `, est $${rm.estimatedCostUsd.toFixed(2)}`
            : '') +
          ')',
      ),
    );
    for (const t of rm.tasks) {
      lines.push(`  ${taskBadge(t.status)} ${t.id}: ${t.title}`);
    }
  }

  if (state.iterations.length > 0) {
    lines.push('');
    lines.push(colors.bold(`Iterations (${state.iterations.length})`));
    for (const it of state.iterations.slice(-5)) {
      const tag = it.mode === 'create' ? '[create]' : '[iterate]';
      const cost = it.costUsd !== undefined ? ` $${it.costUsd.toFixed(4)}` : '';
      const done = it.done ? colors.green('done') : colors.dim('-');
      lines.push(`  ${tag} ${it.ts.slice(0, 16)}  ${done}  overall=${it.overall ?? '-'}${cost}`);
    }
  }

  if (isLegacyState(state)) {
    lines.push('');
    lines.push(colors.dim('(legacy workspace — uaf resume is unavailable)'));
  }

  process.stdout.write(lines.join('\n') + '\n');
}

function colorStatus(s: string): string {
  if (s === 'completed') return colors.green(s);
  if (s === 'failed') return colors.red(s);
  if (s === 'halted') return colors.yellow(s);
  if (s === 'interrupted') return colors.yellow(s);
  return colors.cyan(s);
}

function colorPhase(p: string): string {
  if (p === 'complete') return colors.green(p);
  if (p === 'failed') return colors.red(p);
  if (p === 'interrupted') return colors.yellow(p);
  return colors.cyan(p);
}

function taskBadge(s: string): string {
  switch (s) {
    case 'completed':
      return colors.green('✓');
    case 'in-progress':
      return colors.cyan('⠋');
    case 'failed':
      return colors.red('✗');
    case 'skipped':
      return colors.dim('—');
    case 'pending':
    default:
      return colors.dim('·');
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

async function readTotalCost(workspaceDir: string): Promise<number> {
  let raw: string;
  try {
    raw = await readFile(join(workspaceDir, 'metrics.jsonl'), 'utf8');
  } catch {
    return 0;
  }
  let total = 0;
  for (const line of raw.split('\n')) {
    if (!line) continue;
    try {
      const rec = JSON.parse(line) as MetricRecord;
      total += computeCost(rec.model, {
        inputTokens: rec.inputTokens,
        outputTokens: rec.outputTokens,
        cacheReadTokens: rec.cacheReadTokens,
        cacheCreationTokens: rec.cacheCreationTokens,
      });
    } catch {
      /* skip malformed line */
    }
  }
  return total;
}
