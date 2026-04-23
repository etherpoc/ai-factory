/**
 * `uaf logs <proj-id>` — Phase 7.8.10.
 *
 * Renders the project's log files (`workspace/<proj-id>/logs/*.log`) in a
 * human-friendly pretty format. The files are raw pino JSON lines, one per
 * event — this command:
 *
 *   - prettifies each line (timestamp · level · name · message · fields)
 *   - supports `--tail N` (default 50 with --tail; otherwise dump everything)
 *   - supports `--follow` (poll the file; print new lines as they appear)
 *   - supports `--filter <regex>` to narrow down with a case-insensitive match
 *   - supports `--raw` to bypass prettification (for piping to jq)
 *   - supports `--cmd <name>` to pick a single log file out of logs/
 *
 * If the project has no logs/ directory yet, the command prints a helpful
 * message pointing at where logs will land once `uaf create` / `uaf resume`
 * has run against this workspace.
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { colors } from '../ui/colors.js';
import { loadEffectiveConfig, resolveWorkspaceDir } from '../config/loader.js';
import { UafError } from '../ui/errors.js';
import { findProject } from '../utils/workspace.js';

export interface LogsOptions {
  projectId: string;
  /** Commander's boolean-or-string: `--tail` (true) or `--tail 100`. */
  tail?: boolean | string;
  follow?: boolean;
  filter?: string;
  raw?: boolean;
  cmd?: string;
}

export interface LogsGlobalOpts {
  verbose?: boolean;
  logStream?: boolean;
}

const DEFAULT_TAIL = 50;

export async function runLogs(opts: LogsOptions, _global: LogsGlobalOpts = {}): Promise<void> {
  const { effective: cfg } = await loadEffectiveConfig();
  const workspaceBase = resolveWorkspaceDir(cfg, process.cwd());
  const project = await findProject(workspaceBase, opts.projectId);

  const logsDir = join(project.dir, 'logs');
  let files: string[];
  try {
    const entries = await readdir(logsDir);
    files = entries.filter((e) => e.endsWith('.log'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new UafError(`no logs directory for project: ${opts.projectId}`, {
        code: 'PROJECT_NOT_FOUND',
        hint: `Once you run \`uaf create/resume\`, logs will land in ${logsDir}.`,
      });
    }
    throw err;
  }

  if (files.length === 0) {
    throw new UafError(`no .log files in ${logsDir}`, {
      code: 'PROJECT_NOT_FOUND',
      hint: 'Run `uaf create` or `uaf resume` first, or check the --cmd filter.',
    });
  }

  // When --cmd is passed, narrow down to that file. Otherwise sort by
  // mtime descending so the most recently touched log comes first.
  if (opts.cmd) {
    const wanted = opts.cmd.endsWith('.log') ? opts.cmd : `${opts.cmd}.log`;
    if (!files.includes(wanted)) {
      throw new UafError(`log file not found: ${wanted}`, {
        code: 'PROJECT_NOT_FOUND',
        hint: `Available: ${files.join(', ')}`,
      });
    }
    files = [wanted];
  } else {
    const withMtime = await Promise.all(
      files.map(async (f) => {
        const s = await stat(join(logsDir, f));
        return { f, mtime: s.mtimeMs };
      }),
    );
    withMtime.sort((a, b) => b.mtime - a.mtime);
    files = withMtime.map((w) => w.f);
  }

  const filterRe = opts.filter ? new RegExp(opts.filter, 'i') : null;
  const tailN =
    opts.tail === undefined || opts.tail === false
      ? null
      : opts.tail === true
        ? DEFAULT_TAIL
        : Math.max(1, Number.parseInt(String(opts.tail), 10) || DEFAULT_TAIL);

  for (const f of files) {
    const path = join(logsDir, f);
    if (files.length > 1) {
      process.stdout.write(colors.dim(`\n=== ${f} ===\n`));
    }
    await renderFile(path, { raw: opts.raw === true, filterRe, tailN });
  }

  if (opts.follow) {
    // Follow the FIRST (most-recent) file only. Polling at 500ms is plenty
    // for log tailing — pino's sync destinations mean writes land immediately.
    const path = join(logsDir, files[0]!);
    let prevSize = (await stat(path)).size;
    await new Promise<void>((_resolve) => {
      const timer = setInterval(async () => {
        try {
          const s = await stat(path);
          if (s.size > prevSize) {
            await streamRange(path, prevSize, s.size, {
              raw: opts.raw === true,
              filterRe,
            });
            prevSize = s.size;
          }
        } catch {
          // File may rotate; swallow and keep polling
        }
      }, 500);
      // Ensure Ctrl-C terminates cleanly without a "unhandled exit" stack.
      process.on('SIGINT', () => {
        clearInterval(timer);
        _resolve();
      });
    });
  }
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

interface RenderOpts {
  raw: boolean;
  filterRe: RegExp | null;
  tailN: number | null;
}

async function renderFile(path: string, opts: RenderOpts): Promise<void> {
  const raw = await readFile(path, 'utf8');
  const lines = raw.split('\n').filter(Boolean);
  const filtered = opts.filterRe
    ? lines.filter((l) => (opts.filterRe as RegExp).test(l))
    : lines;
  const toShow = opts.tailN !== null ? filtered.slice(-opts.tailN) : filtered;
  for (const line of toShow) {
    process.stdout.write(
      (opts.raw ? line : prettify(line)) + '\n',
    );
  }
}

async function streamRange(
  path: string,
  start: number,
  end: number,
  opts: Omit<RenderOpts, 'tailN'>,
): Promise<void> {
  const stream = createReadStream(path, { start, end: end - 1, encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    if (opts.filterRe && !opts.filterRe.test(line)) continue;
    process.stdout.write((opts.raw ? line : prettify(line)) + '\n');
  }
}

/**
 * Prettify a single pino JSON line to something like:
 *   10:39:16.752  INFO   uaf.create  starting run  { request, maxIter }
 * Unparseable lines are echoed verbatim.
 */
function prettify(line: string): string {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return line;
  }
  const ts = typeof obj.time === 'number' ? new Date(obj.time).toISOString().slice(11, 23) : '';
  const levelNum = typeof obj.level === 'number' ? obj.level : 30;
  const levelLabel = levelName(levelNum);
  const name = typeof obj.name === 'string' ? obj.name : '';
  const msg = typeof obj.msg === 'string' ? obj.msg : '';
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'time' || k === 'level' || k === 'name' || k === 'msg' || k === 'pid' || k === 'hostname' || k === 'v') continue;
    rest[k] = v;
  }
  const paint = levelPaint(levelLabel);
  const tsCol = ts ? colors.dim(ts) + ' ' : '';
  const extras = Object.keys(rest).length > 0 ? colors.dim(' ' + safeStringify(rest)) : '';
  return `${tsCol}${paint(levelLabel.padEnd(5))} ${colors.cyan(name)}  ${msg}${extras}`;
}

function levelName(num: number): string {
  if (num >= 60) return 'FATAL';
  if (num >= 50) return 'ERROR';
  if (num >= 40) return 'WARN';
  if (num >= 30) return 'INFO';
  if (num >= 20) return 'DEBUG';
  return 'TRACE';
}

function levelPaint(name: string): (s: string) => string {
  switch (name) {
    case 'FATAL':
    case 'ERROR':
      return colors.red;
    case 'WARN':
      return colors.yellow;
    case 'INFO':
      return colors.green;
    case 'DEBUG':
      return colors.blue;
    default:
      return colors.dim;
  }
}

function safeStringify(obj: unknown): string {
  try {
    return JSON.stringify(obj);
  } catch {
    return String(obj);
  }
}
