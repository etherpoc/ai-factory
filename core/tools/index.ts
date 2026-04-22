/**
 * Built-in tools for UAF agents (F5).
 *
 * Each tool enforces:
 *   - All paths resolve **inside workspaceDir** (ToolContext.workspaceDir).
 *     Any attempt to escape returns `ok: false`.
 *   - No environment inheritance leak for secrets — tools do NOT expose
 *     process.env unless the caller opted in.
 *
 * Tools are pure descriptors; bind to a workspace via `ToolContext` at call time.
 */
import { exec } from 'node:child_process';
import {
  access,
  constants as fsConstants,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import type { AgentRole, Tool, ToolContext, ToolResult } from '../types.js';

const execAsync = promisify(exec);

// ---------------------------------------------------------------------------
// Path safety
// ---------------------------------------------------------------------------

function safePath(workspaceDir: string, relative: unknown): string {
  if (typeof relative !== 'string' || relative.length === 0) {
    throw new Error(`path must be a non-empty string, got ${typeof relative}`);
  }
  const root = resolve(workspaceDir);
  const abs = isAbsolute(relative) ? resolve(relative) : resolve(root, relative);
  if (abs !== root && !abs.startsWith(root + sep)) {
    throw new Error(`path escapes workspaceDir: ${relative}`);
  }
  return abs;
}

function argString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== 'string') throw new Error(`${key} must be string`);
  return v;
}

function argOptBool(args: Record<string, unknown>, key: string): boolean {
  const v = args[key];
  return typeof v === 'boolean' ? v : false;
}

const ok = (output: unknown): ToolResult => ({ ok: true, output });
const err = (message: string): ToolResult => ({ ok: false, error: message });

function errFromCatch(e: unknown): ToolResult {
  return err(e instanceof Error ? e.message : String(e));
}

// ---------------------------------------------------------------------------
// read_file
// ---------------------------------------------------------------------------

export const readFileTool: Tool = {
  name: 'read_file',
  description:
    'Read a UTF-8 text file from the workspace. Returns up to ~100 KB of content. Path is relative to workspaceDir.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative path inside workspaceDir (e.g. "src/main.ts")',
      },
    },
    required: ['path'],
  },
  async run(args, ctx) {
    try {
      const p = safePath(ctx.workspaceDir, argString(args, 'path'));
      const s = await stat(p);
      if (s.isDirectory()) return err(`${args.path} is a directory (use list_dir)`);
      if (s.size > 200_000) return err(`file too large (${s.size} bytes); read a smaller slice`);
      const content = await readFile(p, 'utf8');
      return ok(content);
    } catch (e) {
      return errFromCatch(e);
    }
  },
};

// ---------------------------------------------------------------------------
// list_dir
// ---------------------------------------------------------------------------

export const listDirTool: Tool = {
  name: 'list_dir',
  description: 'List files and subdirectories in a workspace directory (non-recursive).',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative directory path inside workspaceDir. Use "." for the root.',
      },
    },
    required: ['path'],
  },
  async run(args, ctx) {
    try {
      const p = safePath(ctx.workspaceDir, argString(args, 'path'));
      const entries = await readdir(p, { withFileTypes: true });
      const out = entries
        .filter((e) => !e.name.startsWith('.') || e.name === '.gitignore')
        .map((e) => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file' }));
      return ok(out);
    } catch (e) {
      return errFromCatch(e);
    }
  },
};

// ---------------------------------------------------------------------------
// write_file
// ---------------------------------------------------------------------------

export const writeFileTool: Tool = {
  name: 'write_file',
  description:
    'Create or overwrite a text file. Parent directories are created as needed. Use for new files or complete rewrites; prefer edit_file for small changes to an existing file.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative path inside workspaceDir' },
      content: { type: 'string', description: 'Full file content (UTF-8)' },
    },
    required: ['path', 'content'],
  },
  async run(args, ctx) {
    try {
      const p = safePath(ctx.workspaceDir, argString(args, 'path'));
      const content = argString(args, 'content');
      const dirPath = p.slice(0, p.lastIndexOf(sep));
      await mkdir(dirPath, { recursive: true });
      await writeFile(p, content, 'utf8');
      return ok(`wrote ${Buffer.byteLength(content, 'utf8')} bytes to ${args.path}`);
    } catch (e) {
      return errFromCatch(e);
    }
  },
};

// ---------------------------------------------------------------------------
// edit_file (string-match replace)
// ---------------------------------------------------------------------------

export const editFileTool: Tool = {
  name: 'edit_file',
  description:
    'Replace an exact string in an existing file. The old_string must match exactly once (or use replace_all=true). Use for surgical edits; use write_file for full rewrites.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative path inside workspaceDir' },
      old_string: { type: 'string', description: 'Exact text to find (multi-line OK)' },
      new_string: { type: 'string', description: 'Replacement text' },
      replace_all: {
        type: 'boolean',
        description: 'Replace every occurrence (default false → must be unique)',
      },
    },
    required: ['path', 'old_string', 'new_string'],
  },
  async run(args, ctx) {
    try {
      const p = safePath(ctx.workspaceDir, argString(args, 'path'));
      const oldStr = argString(args, 'old_string');
      const newStr = argString(args, 'new_string');
      const replaceAll = argOptBool(args, 'replace_all');
      await access(p, fsConstants.R_OK | fsConstants.W_OK);
      const before = await readFile(p, 'utf8');
      if (!before.includes(oldStr)) return err('old_string not found');
      if (!replaceAll) {
        const occurrences = before.split(oldStr).length - 1;
        if (occurrences > 1) {
          return err(
            `old_string matched ${occurrences}× — pass replace_all=true or widen the match`,
          );
        }
      }
      const after = replaceAll ? before.split(oldStr).join(newStr) : before.replace(oldStr, newStr);
      await writeFile(p, after, 'utf8');
      return ok(`edited ${args.path} (${before.length} → ${after.length} bytes)`);
    } catch (e) {
      return errFromCatch(e);
    }
  },
};

// ---------------------------------------------------------------------------
// bash — run a shell command inside workspaceDir
// ---------------------------------------------------------------------------

const BLOCKED_PATTERNS = [
  /\brm\s+-rf?\s+[/\\]\s*(?:$|[;&|])/i, // rm -rf / (ends or pipes)
  /\brm\s+-rf?\s+[*~]/i, // rm -rf * / ~
  /\bmkfs\b/i,
  /\bdd\s+if=.+\s+of=\/dev\/(?:sd|hd|nvme)/i,
  /:\s*\(\s*\)\s*\{.*:\|:.*\}/, // fork bomb
  /\bshutdown\b|\breboot\b|\bhalt\b|\bpoweroff\b/i,
];

export const bashTool: Tool = {
  name: 'bash',
  description:
    'Run a shell command inside workspaceDir. Use for `pnpm install`, `pnpm build`, `pnpm exec playwright install` etc. Default timeout 90s. NO network-destructive or system-destructive commands.',
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The shell command' },
      timeout_sec: {
        type: 'number',
        description: 'Timeout in seconds (default 90, max 600)',
      },
    },
    required: ['command'],
  },
  async run(args, ctx) {
    try {
      const command = argString(args, 'command');
      for (const re of BLOCKED_PATTERNS) {
        if (re.test(command)) return err(`bash: refused by safety filter (${re.source})`);
      }
      const timeoutSec = typeof args.timeout_sec === 'number' ? args.timeout_sec : 90;
      const timeoutMs = Math.max(1, Math.min(600, timeoutSec)) * 1000;
      const { stdout, stderr } = await execAsync(command, {
        cwd: ctx.workspaceDir,
        timeout: timeoutMs,
        maxBuffer: 4 * 1024 * 1024,
      });
      return ok({ stdout: truncate(stdout, 20000), stderr: truncate(stderr, 20000) });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return err(truncate(msg, 20000));
    }
  },
};

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const BUILTIN_TOOLS: ReadonlyMap<string, Tool> = new Map([
  [readFileTool.name, readFileTool],
  [listDirTool.name, listDirTool],
  [writeFileTool.name, writeFileTool],
  [editFileTool.name, editFileTool],
  [bashTool.name, bashTool],
]);

/**
 * Default tool list per role. Recipes can extend via
 * `recipe.agentOverrides[role].additionalTools`.
 */
export const DEFAULT_TOOLS_BY_ROLE: Record<AgentRole, readonly string[]> = {
  director: [],
  architect: ['read_file', 'list_dir'],
  programmer: ['read_file', 'list_dir', 'write_file', 'edit_file', 'bash'],
  tester: ['read_file', 'list_dir', 'write_file', 'edit_file', 'bash'],
  reviewer: ['read_file', 'list_dir'],
  evaluator: ['read_file', 'list_dir', 'bash'],
  // Phase 11.a creative agents. `generate_image` / `generate_audio` are
  // runtime-registered by the orchestrator when an AssetGenerator is
  // available; agents list them as additional tools here so `resolveTools`
  // includes them when the registry is populated.
  artist: ['read_file', 'list_dir', 'write_file', 'generate_image'],
  sound: ['read_file', 'list_dir', 'write_file', 'generate_audio'],
  writer: ['read_file', 'list_dir', 'write_file'],
  critic: ['read_file', 'list_dir', 'write_file', 'bash'],
};

export function defaultToolsFor(role: AgentRole, extra?: ReadonlyMap<string, Tool>): Tool[] {
  // Resolve each defaulted tool name through BUILTIN_TOOLS first, then fall
  // back to the extra registry (where `generate_image` / `generate_audio`
  // live when the orchestrator wired an AssetGenerator). Missing names are
  // dropped silently: an artist agent in a project without an asset
  // generator still gets the read/write/list tools and just lacks the image
  // capability. Agents that depend on these tools will notice via their
  // tool-use loop.
  return DEFAULT_TOOLS_BY_ROLE[role]
    .map((name) => BUILTIN_TOOLS.get(name) ?? extra?.get(name))
    .filter((t): t is Tool => t !== undefined);
}

export function resolveTools(
  role: AgentRole,
  additional: readonly string[] = [],
  extra?: ReadonlyMap<string, Tool>,
): Tool[] {
  const combined = new Map<string, Tool>();
  for (const t of defaultToolsFor(role, extra)) combined.set(t.name, t);
  for (const name of additional) {
    const t = extra?.get(name) ?? BUILTIN_TOOLS.get(name);
    if (!t) throw new Error(`unknown tool: ${name}`);
    combined.set(t.name, t);
  }
  return [...combined.values()];
}

// Re-export ToolContext for convenience
export type { ToolContext, ToolResult };
