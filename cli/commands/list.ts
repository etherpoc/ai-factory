/**
 * `uaf list` — show generated projects under `workspace/`.
 *
 * Phase 7.8: --incomplete filters to projects that `uaf resume` can pick up.
 * Legacy projects (pre-Phase 7.8 — no phase / no roadmap) are tagged with a
 * `legacy` badge and skipped from --incomplete.
 */
import { isResumableState } from '../../core/checkpoint.js';
import { isLegacyState } from '../../core/state.js';
import { loadEffectiveConfig, resolveWorkspaceDir } from '../config/loader.js';
import { colors } from '../ui/colors.js';
import { listProjects, type ProjectEntry } from '../utils/workspace.js';
import { formatDuration } from '../utils/duration.js';

export interface ListOptions {
  recipe?: string;
  status?: string;
  json?: boolean;
  /** Only show projects `uaf resume` can pick up. */
  incomplete?: boolean;
  /** Force inclusion of legacy projects in the table even with --incomplete. */
  all?: boolean;
}

export interface ListGlobalOpts {
  verbose?: boolean;
}

export async function runList(
  opts: ListOptions = {},
  _global: ListGlobalOpts = {},
): Promise<void> {
  const { effective: cfg } = await loadEffectiveConfig();
  const workspaceBase = resolveWorkspaceDir(cfg, process.cwd());
  const projects = await listProjects(workspaceBase);

  const filtered = projects.filter((p) => {
    if (opts.recipe && p.state?.recipeType !== opts.recipe) return false;
    if (opts.status && p.state?.status !== opts.status) return false;
    if (opts.incomplete) {
      // Only resumable, never legacy (legacy can't be resumed).
      if (isLegacyState(p.state) && !opts.all) return false;
      if (!isResumableState(p.state)) return false;
    }
    return true;
  });

  if (opts.json) {
    process.stdout.write(JSON.stringify(filtered.map(serialize), null, 2) + '\n');
    return;
  }

  if (filtered.length === 0) {
    process.stderr.write(colors.dim('No projects found.') + '\n');
    process.stderr.write(colors.dim(`Workspace: ${workspaceBase}\n`));
    return;
  }

  const now = Date.now();
  // Phase 7.8: add a PHASE column when any row has phase info, plus a
  // "legacy" tag when the workspace predates phases entirely.
  const showPhase = filtered.some((p) => p.state?.phase !== undefined);
  const header = showPhase
    ? ['ID', 'RECIPE', 'STATUS', 'PHASE', 'PROGRESS', 'AGE', 'REQUEST']
    : ['ID', 'RECIPE', 'STATUS', 'ITERS', 'AGE', 'REQUEST'];
  const rows: string[][] = [header];
  for (const p of filtered) {
    const s = p.state;
    const ageMs = now - (s ? Date.parse(s.lastRunAt) : p.mtimeMs);
    if (showPhase) {
      const phaseLabel = s?.phase ?? (isLegacyState(s) ? 'legacy' : '-');
      const progress = s?.roadmap
        ? `${s.roadmap.completedTasks}/${s.roadmap.totalTasks}`
        : s
          ? `${s.iterations.length}it`
          : '-';
      rows.push([
        p.projectId,
        s?.recipeType ?? '(unknown)',
        s?.status ?? '(no state)',
        phaseLabel,
        progress,
        formatDuration(ageMs) + ' ago',
        truncate(s?.originalRequest ?? '', 40),
      ]);
    } else {
      rows.push([
        p.projectId,
        s?.recipeType ?? '(unknown)',
        s?.status ?? '(no state)',
        s ? String(s.iterations.length) : '-',
        formatDuration(ageMs) + ' ago',
        truncate(s?.originalRequest ?? '', 50),
      ]);
    }
  }
  process.stdout.write(formatTable(rows) + '\n');
}

function serialize(p: ProjectEntry): Record<string, unknown> {
  return {
    projectId: p.projectId,
    dir: p.dir,
    recipeType: p.state?.recipeType ?? null,
    status: p.state?.status ?? null,
    phase: p.state?.phase ?? null,
    resumable: p.state?.resumable ?? null,
    legacy: isLegacyState(p.state),
    iterations: p.state?.iterations.length ?? null,
    roadmap: p.state?.roadmap
      ? {
          totalTasks: p.state.roadmap.totalTasks,
          completedTasks: p.state.roadmap.completedTasks,
        }
      : null,
    createdAt: p.state?.createdAt ?? null,
    lastRunAt: p.state?.lastRunAt ?? null,
    originalRequest: p.state?.originalRequest ?? null,
  };
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, Math.max(0, n - 1)) + '…';
}

function formatTable(rows: string[][]): string {
  if (rows.length === 0) return '';
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map((r) => r[i]!.length)));
  return rows
    .map((r, idx) => {
      const line = r.map((cell, i) => cell.padEnd(widths[i]!)).join('  ');
      return idx === 0 ? colors.bold(line) : line;
    })
    .join('\n');
}
