/**
 * `uaf clean` — delete old workspaces and iterate snapshots.
 *
 * Scope: everything under `workspace/` whose `lastRunAt` (or mtime, if no
 * state.json) is older than `--older-than`. `workspace/.snapshots/*` is
 * included using each snapshot's mtime.
 */
import { rm } from 'node:fs/promises';
import { isResumableState } from '../../core/checkpoint.js';
import { loadEffectiveConfig, resolveWorkspaceDir } from '../config/loader.js';
import { colors, symbols } from '../ui/colors.js';
import { UafError } from '../ui/errors.js';
import { formatDuration, parseDuration } from '../utils/duration.js';
import { listProjects, listSnapshots } from '../utils/workspace.js';
import { defaultPrompter, withAbortHandling, type Prompter } from '../interactive/prompts.js';

export interface CleanOptions {
  olderThan?: string;
  dryRun?: boolean;
  yes?: boolean;
  /**
   * Phase 7.8: also nuke incomplete (resumable) projects regardless of age.
   * Default: skip them so a long-running build that's currently mid-flight
   * doesn't get yanked out from under the user.
   */
  incomplete?: boolean;
}

export interface CleanDeps {
  prompter?: Prompter;
}

export async function runClean(
  opts: CleanOptions = {},
  _global: unknown = {},
  deps: CleanDeps = {},
): Promise<void> {
  const { effective: cfg } = await loadEffectiveConfig();
  const base = resolveWorkspaceDir(cfg, process.cwd());
  const cutoffAge = parseDuration(opts.olderThan ?? '30d');
  const cutoff = Date.now() - cutoffAge;

  const projects = await listProjects(base);
  const snapshots = await listSnapshots(base);

  const targets: Array<{
    kind: 'project' | 'snapshot';
    name: string;
    dir: string;
    ageMs: number;
    /** Why this project was selected — affects display only. */
    reason?: 'aged' | 'incomplete';
  }> = [];
  for (const p of projects) {
    const ts = p.state ? Date.parse(p.state.lastRunAt) : p.mtimeMs;
    const ageMs = Date.now() - ts;
    const aged = ts < cutoff;
    const resumable = isResumableState(p.state);
    if (resumable && !opts.incomplete && !aged) continue;
    if (resumable && !opts.incomplete && aged) {
      // Aged AND resumable — protect by default. User must explicitly opt in.
      continue;
    }
    if (aged || (opts.incomplete && resumable)) {
      targets.push({
        kind: 'project',
        name: p.projectId,
        dir: p.dir,
        ageMs,
        reason: aged ? 'aged' : 'incomplete',
      });
    }
  }
  for (const s of snapshots) {
    if (s.mtimeMs < cutoff) {
      targets.push({ kind: 'snapshot', name: s.name, dir: s.dir, ageMs: Date.now() - s.mtimeMs });
    }
  }

  if (targets.length === 0) {
    process.stderr.write(colors.dim(`Nothing older than ${formatDuration(cutoffAge)} to clean.\n`));
    return;
  }

  process.stdout.write(colors.bold(`=== uaf clean ===\n`));
  process.stdout.write(`cutoff  : older than ${formatDuration(cutoffAge)}\n`);
  if (opts.incomplete) {
    process.stdout.write(colors.dim('mode    : --incomplete (also targets resumable projects)\n'));
  }
  process.stdout.write(
    `targets : ${targets.length} (${targets.filter((t) => t.kind === 'project').length} projects, ${targets.filter((t) => t.kind === 'snapshot').length} snapshots)\n`,
  );
  for (const t of targets) {
    const tag =
      t.kind === 'snapshot'
        ? colors.dim('snap')
        : t.reason === 'incomplete'
          ? colors.yellow('proj!')
          : colors.cyan('proj');
    process.stdout.write(
      `  ${tag}  ${t.name}${' '.repeat(Math.max(1, 48 - t.name.length))}${formatDuration(t.ageMs)} old\n`,
    );
  }

  if (opts.dryRun) {
    process.stderr.write(colors.dim('\n--dry-run: nothing deleted.\n'));
    return;
  }

  if (!opts.yes) {
    const prompter = deps.prompter ?? (await defaultPrompter());
    const go = await withAbortHandling(() =>
      prompter.confirm({ message: `Delete ${targets.length} target(s)?`, default: false }),
    );
    if (!go) {
      throw new UafError('aborted by user', { code: 'USER_ABORT' });
    }
  }

  let deleted = 0;
  for (const t of targets) {
    try {
      await rm(t.dir, { recursive: true, force: true });
      deleted += 1;
    } catch (err) {
      process.stderr.write(
        colors.red(`${symbols.fail} failed to delete ${t.dir}: ${err instanceof Error ? err.message : String(err)}\n`),
      );
    }
  }
  process.stderr.write(colors.green(`${symbols.ok} deleted ${deleted}/${targets.length}\n`));
}
