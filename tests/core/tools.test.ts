import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nullLogger } from '../../core/logger';
import {
  BUILTIN_TOOLS,
  DEFAULT_TOOLS_BY_ROLE,
  bashTool,
  defaultToolsFor,
  editFileTool,
  listDirTool,
  readFileTool,
  resolveTools,
  writeFileTool,
} from '../../core/tools/index';
import type { ToolContext } from '../../core/types';

describe('tools — path safety + round trip', () => {
  let dir: string;
  let ctx: ToolContext;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'uaf-tools-'));
    ctx = { workspaceDir: dir, projectId: 'p', logger: nullLogger };
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('write_file creates the file and parent dirs', async () => {
    const res = await writeFileTool.run({ path: 'src/a/b.ts', content: 'hello' }, ctx);
    expect(res.ok).toBe(true);
    const s = await stat(join(dir, 'src/a/b.ts'));
    expect(s.isFile()).toBe(true);
  });

  it('read_file returns content after write_file', async () => {
    await writeFileTool.run({ path: 'x.txt', content: 'alpha' }, ctx);
    const res = await readFileTool.run({ path: 'x.txt' }, ctx);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.output).toBe('alpha');
  });

  it('list_dir lists created files', async () => {
    await writeFileTool.run({ path: 'a.txt', content: 'x' }, ctx);
    await writeFileTool.run({ path: 'b.txt', content: 'y' }, ctx);
    const res = await listDirTool.run({ path: '.' }, ctx);
    expect(res.ok).toBe(true);
    if (res.ok) {
      const names = (res.output as { name: string }[]).map((e) => e.name).sort();
      expect(names).toEqual(['a.txt', 'b.txt']);
    }
  });

  it('edit_file replaces an exact match', async () => {
    await writeFileTool.run({ path: 'f.txt', content: 'hello world' }, ctx);
    const res = await editFileTool.run(
      { path: 'f.txt', old_string: 'world', new_string: 'UAF' },
      ctx,
    );
    expect(res.ok).toBe(true);
    expect(await readFile(join(dir, 'f.txt'), 'utf8')).toBe('hello UAF');
  });

  it('edit_file refuses non-unique match unless replace_all=true', async () => {
    await writeFileTool.run({ path: 'f.txt', content: 'ab ab ab' }, ctx);
    const r1 = await editFileTool.run({ path: 'f.txt', old_string: 'ab', new_string: 'cd' }, ctx);
    expect(r1.ok).toBe(false);
    const r2 = await editFileTool.run(
      { path: 'f.txt', old_string: 'ab', new_string: 'cd', replace_all: true },
      ctx,
    );
    expect(r2.ok).toBe(true);
    expect(await readFile(join(dir, 'f.txt'), 'utf8')).toBe('cd cd cd');
  });

  it('path escape is blocked on all tools', async () => {
    for (const t of [readFileTool, listDirTool, writeFileTool, editFileTool]) {
      const args: Record<string, unknown> = {
        path: '../escape.txt',
        content: 'x',
        old_string: 'x',
        new_string: 'y',
      };
      const res = await t.run(args, ctx);
      expect(res.ok, `tool ${t.name} should block path escape`).toBe(false);
    }
  });

  it('write_file refuses absolute paths that escape the workspace', async () => {
    const other = await mkdtemp(join(tmpdir(), 'uaf-other-'));
    try {
      const res = await writeFileTool.run({ path: join(other, 'x.txt'), content: 'boom' }, ctx);
      expect(res.ok).toBe(false);
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  });

  it('read_file rejects files over the size cap', async () => {
    await mkdir(join(dir, 'big'), { recursive: true });
    await writeFile(join(dir, 'big/huge.bin'), Buffer.alloc(300_000));
    const res = await readFileTool.run({ path: 'big/huge.bin' }, ctx);
    expect(res.ok).toBe(false);
  });
});

describe('tools — bash', () => {
  let dir: string;
  let ctx: ToolContext;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'uaf-bash-'));
    ctx = { workspaceDir: dir, projectId: 'p', logger: nullLogger };
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('runs a simple command and returns stdout', async () => {
    const res = await bashTool.run({ command: 'echo hello' }, ctx);
    expect(res.ok).toBe(true);
    if (res.ok) {
      const out = res.output as { stdout: string };
      expect(out.stdout.trim()).toBe('hello');
    }
  });

  it('refuses clearly-destructive commands', async () => {
    const res = await bashTool.run({ command: 'rm -rf /' }, ctx);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/refused/);
  });

  it('runs in the workspaceDir cwd', async () => {
    await writeFile(join(dir, 'marker.txt'), 'present', 'utf8');
    const res = await bashTool.run({ command: 'ls marker.txt' }, ctx);
    expect(res.ok).toBe(true);
  });
});

describe('tools — registry and role defaults', () => {
  it('BUILTIN_TOOLS has the 5 expected tools', () => {
    expect([...BUILTIN_TOOLS.keys()].sort()).toEqual([
      'bash',
      'edit_file',
      'list_dir',
      'read_file',
      'write_file',
    ]);
  });

  it('DEFAULT_TOOLS_BY_ROLE aligns with principle (director=none, programmer=all)', () => {
    expect(DEFAULT_TOOLS_BY_ROLE.director).toEqual([]);
    expect([...DEFAULT_TOOLS_BY_ROLE.programmer].sort()).toEqual([
      'bash',
      'edit_file',
      'list_dir',
      'read_file',
      'write_file',
    ]);
    // read-only roles must not have write_file / edit_file / bash
    expect(DEFAULT_TOOLS_BY_ROLE.reviewer).not.toContain('write_file');
    expect(DEFAULT_TOOLS_BY_ROLE.reviewer).not.toContain('bash');
  });

  it('defaultToolsFor returns Tool instances', () => {
    const programmerTools = defaultToolsFor('programmer');
    expect(programmerTools).toHaveLength(5);
    for (const t of programmerTools) {
      expect(typeof t.name).toBe('string');
      expect(typeof t.description).toBe('string');
      expect(typeof t.run).toBe('function');
    }
  });

  it('resolveTools merges role defaults with additional names', () => {
    const tools = resolveTools('architect', ['bash']);
    const names = tools.map((t) => t.name).sort();
    // architect defaults: read_file, list_dir; + bash
    expect(names).toEqual(['bash', 'list_dir', 'read_file']);
  });
});
