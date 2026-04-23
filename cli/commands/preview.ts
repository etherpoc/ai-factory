/**
 * `uaf preview <proj-id>` (Phase 7.8.6).
 *
 * Get the generated project up and running so the user can poke at it.
 * Per-recipe handlers know how to call pnpm install + build (cached) and
 * spawn the right dev server. Port collisions on 5173 / 3000 / 4173 / 8080
 * fall back to the next free port automatically and the chosen port is
 * surfaced to the user.
 *
 *   uaf preview <id>                  # foreground; Ctrl+C stops
 *   uaf preview <id> --detach         # background; pid/port in state.json.preview
 *   uaf preview --stop <id>           # stop the detached server for one project
 *   uaf preview --stop-all            # stop every detached server
 *   uaf preview <id> --run "<args>"   # cli recipes only — execute the binary
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { upsertWorkspaceState } from '../../core/state.js';
import { loadEffectiveConfig, resolveWorkspaceDir } from '../config/loader.js';
import { colors } from '../ui/colors.js';
import { UafError } from '../ui/errors.js';
import { findFreePort } from '../utils/ports.js';
import { openInBrowser } from '../utils/editor.js';
import { findProject, listProjects } from '../utils/workspace.js';

export interface PreviewOptions {
  projectId?: string;
  detach?: boolean;
  stop?: boolean;
  stopAll?: boolean;
  /** cli recipes: run binary with these args instead of an interactive shell. */
  run?: string;
  /** Skip the auto browser open. */
  noOpen?: boolean;
  /** Override the canonical port. */
  port?: string;
}

export async function runPreview(opts: PreviewOptions = {}, _global: unknown = {}): Promise<void> {
  const { effective: cfg } = await loadEffectiveConfig();
  const workspaceBase = resolveWorkspaceDir(cfg, process.cwd());

  // ---- --stop-all
  if (opts.stopAll) {
    await stopAllPreviews(workspaceBase);
    return;
  }
  if (!opts.projectId) {
    throw new UafError('missing project id', {
      code: 'ARG_MISSING',
      hint: 'Usage: uaf preview <proj-id> [--detach|--stop|--run "<args>"]. Use --stop-all without an id.',
    });
  }
  const project = await findProject(workspaceBase, opts.projectId);

  // ---- --stop <id>
  if (opts.stop) {
    await stopOnePreview(project.dir, project.state?.preview);
    return;
  }

  if (!project.state) {
    throw new UafError('cannot preview: no state.json', {
      code: 'PROJECT_NOT_FOUND',
      hint: 'This workspace lacks state.json (legacy or partial). Inspect the directory manually.',
    });
  }
  const recipeType = project.state.recipeType;

  // ---- Refuse to launch a second preview for the same project.
  if (project.state.preview && (await isProcessAlive(project.state.preview.pid))) {
    process.stderr.write(
      colors.yellow(
        `⚠ A preview is already running for ${project.projectId} (pid=${project.state.preview.pid}` +
          (project.state.preview.url ? `, url=${project.state.preview.url}` : '') +
          `). Use \`uaf preview --stop ${project.projectId}\` first.\n`,
      ),
    );
    return;
  }

  // ---- Dispatch to handler.
  const handler = getHandlers()[recipeType];
  if (!handler) {
    throw new UafError(`no preview handler for recipe type: ${recipeType}`, {
      code: 'RUNTIME_FAILURE',
      hint: `Add a handler for "${recipeType}" in cli/commands/preview.ts.`,
    });
  }
  await handler({
    project,
    detach: opts.detach === true,
    runArgs: opts.run,
    openBrowser: opts.noOpen !== true,
    portOverride: opts.port ? Number.parseInt(opts.port, 10) : undefined,
    upsert: async (preview) => {
      await upsertWorkspaceState(project.dir, {
        projectId: project.projectId,
        recipeType,
        originalRequest: project.state!.originalRequest,
        status: project.state!.status,
        preview,
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Handler types
// ---------------------------------------------------------------------------

interface HandlerCtx {
  project: { projectId: string; dir: string; state: import('../../core/state.js').WorkspaceState | null };
  detach: boolean;
  runArgs?: string | undefined;
  openBrowser: boolean;
  portOverride?: number | undefined;
  upsert(preview: import('../../core/state.js').PreviewState | null): Promise<void>;
}

type Handler = (ctx: HandlerCtx) => Promise<void>;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function ensureInstalled(dir: string): Promise<void> {
  const nodeModules = join(dir, 'node_modules');
  if (await pathExists(nodeModules)) {
    process.stderr.write(colors.dim('node_modules present — skipping pnpm install\n'));
    return;
  }
  process.stderr.write(colors.cyan('Running pnpm install (first run, this can take a minute)…\n'));
  await runForeground('pnpm', ['install', '--prefer-offline', '--ignore-workspace'], {
    cwd: dir,
  }).catch((err) => {
    throw new UafError('pnpm install failed', {
      code: 'RUNTIME_FAILURE',
      cause: err,
      hint:
        'Check network connectivity, then `uaf doctor`. ' +
        'You can also run `pnpm install --prefer-offline --ignore-workspace` manually inside the workspace.',
    });
  });
}

async function runBuild(dir: string, script: string): Promise<void> {
  process.stderr.write(colors.cyan(`Building (pnpm ${script})…\n`));
  try {
    await runForeground('pnpm', ['--ignore-workspace', script], { cwd: dir });
  } catch (err) {
    throw new UafError(`build failed: pnpm ${script}`, {
      code: 'RUNTIME_FAILURE',
      cause: err,
      hint: 'Inspect the error above. The relevant source file path is usually in the trace.',
    });
  }
}

interface RunForegroundOptions {
  cwd: string;
  env?: Record<string, string>;
}

function runForeground(
  cmd: string,
  args: string[],
  opts: RunForegroundOptions,
): Promise<void> {
  return new Promise((resolveFn, rejectFn) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: { ...process.env, ...(opts.env ?? {}) },
    });
    child.on('error', rejectFn);
    child.on('exit', (code) => {
      if (code === 0 || code === null) resolveFn();
      else rejectFn(new Error(`exit ${code}`));
    });
  });
}

interface SpawnDetachedOptions extends RunForegroundOptions {
  /** Optional log file to redirect output to in detached mode. */
  logFile?: string;
}

function spawnTracked(
  cmd: string,
  args: string[],
  opts: SpawnDetachedOptions & { detach: boolean },
): ChildProcess {
  if (opts.detach) {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      detached: true,
      stdio: 'ignore',
      shell: process.platform === 'win32',
      env: { ...process.env, ...(opts.env ?? {}) },
    });
    child.unref();
    return child;
  }
  return spawn(cmd, args, {
    cwd: opts.cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...(opts.env ?? {}) },
  });
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function isProcessAlive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function stopOnePreview(
  dir: string,
  preview: import('../../core/state.js').PreviewState | undefined,
): Promise<void> {
  if (!preview) {
    process.stderr.write(colors.dim('No preview is recorded for this project.\n'));
    return;
  }
  const alive = await isProcessAlive(preview.pid);
  if (alive) {
    try {
      process.kill(preview.pid, 'SIGTERM');
      process.stderr.write(colors.green(`✓ stopped pid ${preview.pid}\n`));
    } catch (err) {
      process.stderr.write(
        colors.yellow(
          `kill(${preview.pid}) failed: ${err instanceof Error ? err.message : String(err)}\n`,
        ),
      );
    }
  } else {
    process.stderr.write(
      colors.dim(`pid ${preview.pid} is no longer running; clearing stale entry.\n`),
    );
  }
  // Clear the field either way.
  const { readWorkspaceState } = await import('../../core/state.js');
  const state = await readWorkspaceState(dir);
  if (state) {
    await upsertWorkspaceState(dir, {
      projectId: state.projectId,
      recipeType: state.recipeType,
      originalRequest: state.originalRequest,
      status: state.status,
      preview: null,
    });
  }
}

async function stopAllPreviews(workspaceBase: string): Promise<void> {
  const projects = await listProjects(workspaceBase);
  let stopped = 0;
  for (const p of projects) {
    if (!p.state?.preview) continue;
    await stopOnePreview(p.dir, p.state.preview);
    stopped += 1;
  }
  process.stderr.write(colors.green(`✓ stopped ${stopped} preview(s)\n`));
}

function announceUrl(url: string, port: number, preferred: number): void {
  const portWarn = port !== preferred ? colors.yellow(` (preferred ${preferred} was taken)`) : '';
  process.stdout.write(colors.bold(`\n  → ${url}`) + portWarn + '\n\n');
}

// ---------------------------------------------------------------------------
// Recipe handlers
// ---------------------------------------------------------------------------

// Handler table — built lazily so the `const apiHandler = …` definitions
// below can be referenced after they're declared.
function buildHandlerTable(): Record<string, Handler> {
  return {
    '2d-game': viteHandler({ preferredPort: 5173, script: 'dev' }),
    '3d-game': viteHandler({ preferredPort: 5173, script: 'dev' }),
    'web-app': nextHandler({ preferredPort: 3000 }),
    api: apiHandler,
    cli: cliHandler,
    'mobile-app': mobileHandler,
    'desktop-app': desktopHandler,
  };
}
let HANDLER_CACHE: Record<string, Handler> | undefined;
function getHandlers(): Record<string, Handler> {
  if (!HANDLER_CACHE) HANDLER_CACHE = buildHandlerTable();
  return HANDLER_CACHE;
}

function viteHandler(opts: { preferredPort: number; script: string }): Handler {
  return async (ctx) => {
    await ensureInstalled(ctx.project.dir);
    const preferred = ctx.portOverride ?? opts.preferredPort;
    const port = await findFreePort({ preferred });
    if (port !== preferred) {
      process.stderr.write(
        colors.dim(`port ${preferred} in use — using ${port} instead\n`),
      );
    }
    const args = ['--ignore-workspace', opts.script, '--', '--port', String(port), '--strictPort'];
    const cmdLine = `pnpm ${args.join(' ')}`;
    process.stderr.write(colors.cyan(`Starting Vite dev server (${cmdLine})…\n`));
    const child = spawnTracked('pnpm', args, { cwd: ctx.project.dir, detach: ctx.detach });
    const url = `http://localhost:${port}/`;
    if (!child.pid) throw new UafError('failed to spawn vite', { code: 'RUNTIME_FAILURE' });

    await ctx.upsert({
      pid: child.pid,
      port,
      url,
      startedAt: new Date().toISOString(),
      detached: ctx.detach,
      command: cmdLine,
    });
    announceUrl(url, port, opts.preferredPort);
    if (ctx.openBrowser && !ctx.detach) {
      // Give vite a moment to start listening before opening the tab.
      setTimeout(() => {
        openInBrowser(url).catch(() => undefined);
      }, 1500);
    }
    if (ctx.detach) {
      process.stderr.write(
        colors.dim(`detached; stop with: uaf preview --stop ${ctx.project.projectId}\n`),
      );
      return;
    }
    await waitForExit(child);
    await ctx.upsert(null);
  };
}

function nextHandler(opts: { preferredPort: number }): Handler {
  return async (ctx) => {
    await ensureInstalled(ctx.project.dir);
    const preferred = ctx.portOverride ?? opts.preferredPort;
    const port = await findFreePort({ preferred });
    if (port !== preferred) {
      process.stderr.write(colors.dim(`port ${preferred} in use — using ${port} instead\n`));
    }
    const args = ['--ignore-workspace', 'dev', '--', '-p', String(port)];
    const cmdLine = `pnpm ${args.join(' ')}`;
    process.stderr.write(colors.cyan(`Starting Next.js dev server (${cmdLine})…\n`));
    const child = spawnTracked('pnpm', args, { cwd: ctx.project.dir, detach: ctx.detach });
    const url = `http://localhost:${port}/`;
    if (!child.pid) throw new UafError('failed to spawn next', { code: 'RUNTIME_FAILURE' });
    await ctx.upsert({
      pid: child.pid,
      port,
      url,
      startedAt: new Date().toISOString(),
      detached: ctx.detach,
      command: cmdLine,
    });
    announceUrl(url, port, opts.preferredPort);
    if (ctx.openBrowser && !ctx.detach) {
      setTimeout(() => openInBrowser(url).catch(() => undefined), 2500);
    }
    if (ctx.detach) {
      process.stderr.write(
        colors.dim(`detached; stop with: uaf preview --stop ${ctx.project.projectId}\n`),
      );
      return;
    }
    await waitForExit(child);
    await ctx.upsert(null);
  };
}

const apiHandler: Handler = async (ctx) => {
  await ensureInstalled(ctx.project.dir);
  const preferred = ctx.portOverride ?? 8080;
  const port = await findFreePort({ preferred });
  if (port !== preferred) {
    process.stderr.write(colors.dim(`port ${preferred} in use — using ${port} instead\n`));
  }
  const cmdLine = 'pnpm --ignore-workspace dev';
  process.stderr.write(colors.cyan(`Starting API dev server (${cmdLine}, PORT=${port})…\n`));
  const child = spawnTracked('pnpm', ['--ignore-workspace', 'dev'], {
    cwd: ctx.project.dir,
    detach: ctx.detach,
    env: { PORT: String(port) },
  });
  const url = `http://localhost:${port}/`;
  if (!child.pid) throw new UafError('failed to spawn api server', { code: 'RUNTIME_FAILURE' });
  await ctx.upsert({
    pid: child.pid,
    port,
    url,
    startedAt: new Date().toISOString(),
    detached: ctx.detach,
    command: cmdLine,
  });
  announceUrl(url, port, preferred);
  process.stderr.write(
    colors.dim(
      'Try the API:\n' +
        `  curl ${url}\n` +
        `  curl ${url}health  (if implemented)\n`,
    ),
  );
  if (ctx.detach) {
    process.stderr.write(
      colors.dim(`detached; stop with: uaf preview --stop ${ctx.project.projectId}\n`),
    );
    return;
  }
  await waitForExit(child);
  await ctx.upsert(null);
};

const cliHandler: Handler = async (ctx) => {
  await ensureInstalled(ctx.project.dir);
  // Build is required so dist/cli.js exists for `bin`.
  await runBuild(ctx.project.dir, 'build');

  if (ctx.runArgs !== undefined) {
    const runArgs = ctx.runArgs.trim();
    process.stderr.write(colors.cyan(`Running CLI: pnpm dev ${runArgs}\n`));
    // `pnpm dev` runs `tsx src/cli.ts`. Append --run args after `--`.
    await runForeground(
      'pnpm',
      ['--ignore-workspace', 'dev', '--', ...runArgs.split(/\s+/).filter(Boolean)],
      { cwd: ctx.project.dir },
    ).catch((err) => {
      throw new UafError('CLI exited with non-zero status', {
        code: 'RUNTIME_FAILURE',
        cause: err,
      });
    });
    return;
  }

  process.stderr.write(
    colors.bold('\n  CLI built. Try one of:\n') +
      '    cd ' +
      ctx.project.dir +
      ' && pnpm dev -- --help\n' +
      '    uaf preview ' +
      ctx.project.projectId +
      ' --run "--help"\n\n',
  );
};

const mobileHandler: Handler = async (ctx) => {
  await ensureInstalled(ctx.project.dir);
  const cmdLine = 'pnpm --ignore-workspace start';
  process.stderr.write(
    colors.cyan(`Starting Expo dev server (${cmdLine})…\n`) +
      colors.dim('Scan the QR code with the Expo Go app, or press w for web preview.\n'),
  );
  const child = spawnTracked('pnpm', ['--ignore-workspace', 'start'], {
    cwd: ctx.project.dir,
    detach: ctx.detach,
  });
  if (!child.pid) throw new UafError('failed to spawn expo', { code: 'RUNTIME_FAILURE' });
  await ctx.upsert({
    pid: child.pid,
    startedAt: new Date().toISOString(),
    detached: ctx.detach,
    command: cmdLine,
  });
  if (ctx.detach) {
    process.stderr.write(
      colors.dim(`detached; stop with: uaf preview --stop ${ctx.project.projectId}\n`),
    );
    return;
  }
  await waitForExit(child);
  await ctx.upsert(null);
};

const desktopHandler: Handler = async (ctx) => {
  await ensureInstalled(ctx.project.dir);
  // dev runs `concurrently vite + tsc -w`. Renderer ends up on 5173 by default;
  // we let vite handle the port collision.
  const cmdLine = 'pnpm --ignore-workspace dev';
  process.stderr.write(colors.cyan(`Starting Electron renderer dev (${cmdLine})…\n`));
  const child = spawnTracked('pnpm', ['--ignore-workspace', 'dev'], {
    cwd: ctx.project.dir,
    detach: ctx.detach,
  });
  if (!child.pid) throw new UafError('failed to spawn electron dev', { code: 'RUNTIME_FAILURE' });
  await ctx.upsert({
    pid: child.pid,
    startedAt: new Date().toISOString(),
    detached: ctx.detach,
    command: cmdLine,
  });
  process.stderr.write(
    colors.dim(
      'Renderer is on http://localhost:5173/. Run `pnpm start` separately for the Electron shell.\n',
    ),
  );
  if (ctx.detach) {
    process.stderr.write(
      colors.dim(`detached; stop with: uaf preview --stop ${ctx.project.projectId}\n`),
    );
    return;
  }
  await waitForExit(child);
  await ctx.upsert(null);
};

function waitForExit(child: ChildProcess): Promise<void> {
  return new Promise((resolveFn) => {
    child.on('exit', () => resolveFn());
    child.on('error', () => resolveFn());
  });
}
