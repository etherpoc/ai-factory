import { execFile } from 'node:child_process';
import { access, mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { Logger, WorkspaceHandle } from './types.js';
import { nullLogger } from './logger.js';

const execFileAsync = promisify(execFile);

export interface CreateWorkspaceOptions {
  projectId: string;
  /** Defaults to process.cwd(). */
  repoRoot?: string;
  logger?: Logger;
}

/**
 * Create an isolated plain directory at `<repoRoot>/workspace/<projectId>`.
 *
 * This is the default. Earlier versions used a git worktree, but that checks
 * out the parent repo's contents into the dir, which pollutes scaffold output
 * (see FINDINGS.md F6). If you want worktree-based isolation, use
 * `createGitWorktreeWorkspace`.
 */
export async function createWorkspace(opts: CreateWorkspaceOptions): Promise<WorkspaceHandle> {
  const repoRoot = resolve(opts.repoRoot ?? process.cwd());
  const logger = opts.logger ?? nullLogger;
  const projectId = opts.projectId;
  const dir = join(repoRoot, 'workspace', projectId);

  if (await pathExists(dir)) {
    throw new Error(
      `workspace directory already exists: ${dir}. Run cleanup or pick a different projectId.`,
    );
  }

  await mkdir(dir, { recursive: true });
  logger.debug('workspace: plain dir created', { dir });

  return {
    projectId,
    dir,
    branch: '(plain-dir)',
    cleanup: async () => {
      logger.debug('workspace: removing plain dir', { dir });
      await rm(dir, { recursive: true, force: true });
    },
  };
}

// ---------------------------------------------------------------------------
// Optional git-worktree variant (opt-in)
// ---------------------------------------------------------------------------

export interface CreateGitWorktreeWorkspaceOptions extends CreateWorkspaceOptions {
  /** Branch to base the worktree on. Defaults to the repo's current HEAD. */
  baseBranch?: string;
  /** Branch name for the worktree. Defaults to `uaf/<projectId>`. */
  branch?: string;
}

/**
 * Create a git worktree at `<repoRoot>/workspace/<projectId>` on a new branch.
 * Useful when you explicitly want git integration (diff against base branch etc.)
 * — **not** for scaffolding a fresh project, because the worktree inherits the
 * parent repo's working-tree contents.
 */
export async function createGitWorktreeWorkspace(
  opts: CreateGitWorktreeWorkspaceOptions,
): Promise<WorkspaceHandle> {
  const repoRoot = resolve(opts.repoRoot ?? process.cwd());
  const logger = opts.logger ?? nullLogger;
  const projectId = opts.projectId;
  const branch = opts.branch ?? `uaf/${projectId}`;
  const dir = join(repoRoot, 'workspace', projectId);

  if (await pathExists(dir)) {
    throw new Error(
      `workspace directory already exists: ${dir}. Run cleanup or pick a different projectId.`,
    );
  }

  const args = ['worktree', 'add', '-b', branch, dir];
  if (opts.baseBranch) args.push(opts.baseBranch);

  logger.debug('workspace: creating worktree', { dir, branch, baseBranch: opts.baseBranch });
  await runGit(args, repoRoot);

  return {
    projectId,
    dir,
    branch,
    cleanup: async () => {
      logger.debug('workspace: cleaning up worktree', { dir, branch });
      try {
        await runGit(['worktree', 'remove', '--force', dir], repoRoot);
      } catch (err) {
        logger.warn('workspace: git worktree remove failed — falling back to rm -rf', {
          error: errMessage(err),
        });
        await rm(dir, { recursive: true, force: true });
      }
      try {
        await runGit(['branch', '-D', branch], repoRoot);
      } catch (err) {
        logger.debug('workspace: branch already gone', { branch, error: errMessage(err) });
      }
    },
  };
}

/** List workspaces that exist on disk under `<repoRoot>/workspace/`. */
export async function listExistingWorkspaces(repoRoot: string): Promise<string[]> {
  const root = join(resolve(repoRoot), 'workspace');
  const { readdir } = await import('node:fs/promises');
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

async function runGit(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, { cwd });
    return { stdout, stderr };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`git ${args.join(' ')} failed: ${msg}`);
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
