/**
 * `uaf list` — show generated projects under `workspace/`.
 */
import { loadEffectiveConfig, resolveWorkspaceDir } from '../config/loader.js';
import { colors } from '../ui/colors.js';
import { listProjects, type ProjectEntry } from '../utils/workspace.js';
import { formatDuration } from '../utils/duration.js';

export interface ListOptions {
  recipe?: string;
  status?: string;
  json?: boolean;
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
  const rows: string[][] = [['ID', 'RECIPE', 'STATUS', 'ITERS', 'AGE', 'REQUEST']];
  for (const p of filtered) {
    const s = p.state;
    const ageMs = now - (s ? Date.parse(s.lastRunAt) : p.mtimeMs);
    rows.push([
      p.projectId,
      s?.recipeType ?? '(unknown)',
      s?.status ?? '(no state)',
      s ? String(s.iterations.length) : '-',
      formatDuration(ageMs) + ' ago',
      truncate(s?.originalRequest ?? '', 50),
    ]);
  }
  process.stdout.write(formatTable(rows) + '\n');
}

function serialize(p: ProjectEntry): Record<string, unknown> {
  return {
    projectId: p.projectId,
    dir: p.dir,
    recipeType: p.state?.recipeType ?? null,
    status: p.state?.status ?? null,
    iterations: p.state?.iterations.length ?? null,
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
