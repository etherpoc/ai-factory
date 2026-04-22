import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createGitWorktreeWorkspace,
  createWorkspace,
  listExistingWorkspaces,
} from '../../core/workspace-manager';

const execFileAsync = promisify(execFile);

async function initRepo(dir: string) {
  await execFileAsync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  await execFileAsync('git', ['config', 'user.name', 'Tester'], { cwd: dir });
  await writeFile(join(dir, 'README.md'), '# test\n', 'utf8');
  await execFileAsync('git', ['add', '-A'], { cwd: dir });
  await execFileAsync('git', ['commit', '-qm', 'init'], { cwd: dir });
}

describe('workspace-manager — plain-dir default (F6)', () => {
  let repoRoot: string;
  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'uaf-repo-'));
  });
  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it('creates an empty isolated directory at workspace/<id>/', async () => {
    const handle = await createWorkspace({ projectId: 'p1', repoRoot });
    expect(handle.dir).toBe(join(repoRoot, 'workspace', 'p1'));
    expect(handle.branch).toBe('(plain-dir)');
    const s = await stat(handle.dir);
    expect(s.isDirectory()).toBe(true);
    const entries = await readdir(handle.dir);
    expect(entries).toEqual([]);
    await handle.cleanup();
    const after = await listExistingWorkspaces(repoRoot);
    expect(after).not.toContain('p1');
  });

  it('does NOT pollute the workspace with repo-root contents', async () => {
    // Even if the repoRoot has files, the plain-dir workspace must start empty.
    await writeFile(join(repoRoot, 'SHOULD_NOT_APPEAR.md'), '# nope', 'utf8');
    const handle = await createWorkspace({ projectId: 'p-clean', repoRoot });
    const entries = await readdir(handle.dir);
    expect(entries).toEqual([]);
    await handle.cleanup();
  });

  it('refuses to create a workspace that already exists', async () => {
    const handle = await createWorkspace({ projectId: 'p2', repoRoot });
    await expect(createWorkspace({ projectId: 'p2', repoRoot })).rejects.toThrow(/already exists/);
    await handle.cleanup();
  });

  it('listExistingWorkspaces returns the directory names', async () => {
    const h1 = await createWorkspace({ projectId: 'aaa', repoRoot });
    const h2 = await createWorkspace({ projectId: 'bbb', repoRoot });
    const names = await listExistingWorkspaces(repoRoot);
    expect(names.sort()).toEqual(['aaa', 'bbb']);
    await h1.cleanup();
    await h2.cleanup();
  });
});

describe('workspace-manager — createGitWorktreeWorkspace (opt-in)', () => {
  let repoRoot: string;
  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'uaf-repo-git-'));
    await initRepo(repoRoot);
  });
  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it('creates a worktree on a fresh branch', async () => {
    const handle = await createGitWorktreeWorkspace({ projectId: 'p1', repoRoot });
    expect(handle.dir).toBe(join(repoRoot, 'workspace', 'p1'));
    expect(handle.branch).toBe('uaf/p1');
    const { stdout } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], {
      cwd: repoRoot,
    });
    expect(stdout).toContain('p1');
    expect(stdout).toContain('uaf/p1');
    await handle.cleanup();
  });
});
