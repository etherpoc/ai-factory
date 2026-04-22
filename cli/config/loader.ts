/**
 * Config loader / merger (Phase 7.2).
 *
 * Precedence: project (`./.uafrc`) > global (`~/.uaf/config.yaml`) > built-in
 * defaults. Scalars override by position; the only nested object (`models`)
 * merges deeply so a user can override just one role.
 *
 * All I/O is async; every error surfaces as a `UafError` with a stable code so
 * `cli/ui/exit-codes.ts` can route the process exit status.
 */
import { homedir } from 'node:os';
import { join, isAbsolute, resolve } from 'node:path';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parse as yamlParse, stringify as yamlStringify, YAMLParseError } from 'yaml';
import { z } from 'zod';
import { UafError } from '../ui/errors.js';
import { BUILT_IN_DEFAULTS, CONFIG_FILES } from './defaults.js';
import {
  KNOWN_CONFIG_KEYS,
  UafConfigSchema,
  isKnownConfigKey,
  type ConfigKey,
  type UafConfig,
} from './schema.js';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export interface ConfigPaths {
  /** Absolute path to the global config file. */
  global: string;
  /** Absolute path to the project config file. */
  project: string;
}

export interface ResolvePathOptions {
  /** Project cwd. Defaults to process.cwd(). */
  cwd?: string;
  /** Override home directory (useful for tests). */
  home?: string;
}

export function resolveConfigPaths(opts: ResolvePathOptions = {}): ConfigPaths {
  const home = opts.home ?? homedir();
  const cwd = opts.cwd ?? process.cwd();
  return {
    global: join(home, CONFIG_FILES.global),
    project: join(cwd, CONFIG_FILES.project),
  };
}

/** `true` if the file exists and is readable. */
export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Read + parse
// ---------------------------------------------------------------------------

/**
 * Read and validate a single YAML config file. Returns `null` when the file
 * does not exist. Throws `UafError(CONFIG_PARSE_ERROR)` on bad YAML and
 * `UafError(CONFIG_INVALID)` on schema violation.
 */
export async function readConfigFile(path: string): Promise<UafConfig | null> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new UafError(`failed to read config file: ${path}`, {
      code: 'CONFIG_PARSE_ERROR',
      cause: err,
      hint: 'Check file permissions or delete the file to regenerate defaults.',
      logPath: path,
    });
  }

  // Empty file is a no-op, not an error — treat it like an unset file.
  if (raw.trim() === '') return {};

  let parsed: unknown;
  try {
    parsed = yamlParse(raw);
  } catch (err) {
    const msg = err instanceof YAMLParseError ? err.message : String(err);
    throw new UafError(`invalid YAML in ${path}`, {
      code: 'CONFIG_PARSE_ERROR',
      cause: err,
      details: { yamlError: msg },
      hint: 'Fix the YAML syntax or remove the file. Use `uaf config list` to see the effective values after edits.',
      logPath: path,
    });
  }

  // Null top-level YAML (`---`) → treat as empty.
  if (parsed === null || parsed === undefined) return {};
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new UafError(`config must be a YAML mapping, got ${typeof parsed}`, {
      code: 'CONFIG_INVALID',
      hint: 'The top-level of the file must be a key/value mapping.',
      logPath: path,
    });
  }

  const result = UafConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new UafError(`config schema violation in ${path}`, {
      code: 'CONFIG_INVALID',
      details: { issues: formatZodIssues(result.error) },
      hint: 'Run `uaf config list` to inspect known keys, or check docs/COMMANDS.md.',
      logPath: path,
    });
  }

  return result.data;
}

function formatZodIssues(err: z.ZodError): string[] {
  return err.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

/**
 * Merge order (lowest → highest precedence): defaults, global, project. Only
 * `models` merges deeply; other keys are scalar-replace.
 */
export function mergeConfigs(...layers: (UafConfig | null | undefined)[]): UafConfig {
  const base: UafConfig = { ...BUILT_IN_DEFAULTS };
  const merged: UafConfig = { ...base };
  for (const layer of layers) {
    if (!layer) continue;
    for (const [key, value] of Object.entries(layer) as [keyof UafConfig, unknown][]) {
      if (value === undefined) continue;
      if (key === 'models') {
        merged.models = { ...(merged.models ?? {}), ...(value as UafConfig['models']) };
      } else if (key === 'classifier') {
        merged.classifier = {
          ...(merged.classifier ?? {}),
          ...(value as UafConfig['classifier']),
        };
      } else {
        // Safe: keys came from the config object, values type-checked by zod.
        (merged as Record<string, unknown>)[key] = value;
      }
    }
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Effective config
// ---------------------------------------------------------------------------

export interface EffectiveConfigSources {
  /** Built-in defaults — always present. */
  defaults: UafConfig;
  /** Global file — undefined when the file doesn't exist. */
  global?: UafConfig;
  /** Project file — undefined when the file doesn't exist. */
  project?: UafConfig;
}

export interface EffectiveConfig {
  /** Merged, ready-to-use config. */
  effective: UafConfig;
  /** Raw contents of each layer for `uaf config list`. */
  sources: EffectiveConfigSources;
  /** Absolute paths of the files that were considered. */
  paths: ConfigPaths;
}

export interface LoadEffectiveConfigOptions extends ResolvePathOptions {
  /** Skip the global file entirely (for `--project`-only lookups). */
  skipGlobal?: boolean;
  /** Skip the project file entirely (for `--global`-only lookups). */
  skipProject?: boolean;
  /** Inject pre-parsed layers for tests. When set, skips disk reads. */
  inject?: { global?: UafConfig; project?: UafConfig };
}

export async function loadEffectiveConfig(
  opts: LoadEffectiveConfigOptions = {},
): Promise<EffectiveConfig> {
  const paths = resolveConfigPaths(opts);
  const sources: EffectiveConfigSources = { defaults: { ...BUILT_IN_DEFAULTS } };

  if (opts.inject) {
    if (opts.inject.global && !opts.skipGlobal) sources.global = opts.inject.global;
    if (opts.inject.project && !opts.skipProject) sources.project = opts.inject.project;
  } else {
    if (!opts.skipGlobal) {
      const g = await readConfigFile(paths.global);
      if (g) sources.global = g;
    }
    if (!opts.skipProject) {
      const p = await readConfigFile(paths.project);
      if (p) sources.project = p;
    }
  }

  const effective = mergeConfigs(sources.defaults, sources.global, sources.project);
  return { effective, sources, paths };
}

// ---------------------------------------------------------------------------
// Dotted-key accessors for `uaf config get|set`
// ---------------------------------------------------------------------------

const SCALAR_COERCE: Record<string, (s: string) => unknown> = {
  budget_usd: (s) => parseNumberOrThrow(s, 'budget_usd'),
  max_iterations: (s) => parseIntOrThrow(s, 'max_iterations'),
  max_rounds: (s) => parseIntOrThrow(s, 'max_rounds'),
  'assets.budget_usd': (s) => parseNumberOrThrow(s, 'assets.budget_usd'),
  'assets.cache.enabled': (s) => parseBoolOrThrow(s, 'assets.cache.enabled'),
};

function parseNumberOrThrow(s: string, key: string): number {
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n)) {
    throw new UafError(`cannot parse "${s}" as a number for ${key}`, {
      code: 'CONFIG_INVALID',
    });
  }
  return n;
}

function parseIntOrThrow(s: string, key: string): number {
  const n = Number.parseInt(s, 10);
  if (!Number.isInteger(n) || String(n) !== s) {
    throw new UafError(`cannot parse "${s}" as an integer for ${key}`, {
      code: 'CONFIG_INVALID',
    });
  }
  return n;
}

function parseBoolOrThrow(s: string, key: string): boolean {
  const lower = s.toLowerCase();
  if (lower === 'true' || lower === '1' || lower === 'yes') return true;
  if (lower === 'false' || lower === '0' || lower === 'no') return false;
  throw new UafError(`cannot parse "${s}" as a boolean for ${key}`, {
    code: 'CONFIG_INVALID',
  });
}

/** Get a dotted key from a config object. Returns undefined if absent. */
export function getByDottedKey(cfg: UafConfig, key: string): unknown {
  if (!isKnownConfigKey(key)) {
    throw new UafError(`unknown config key: ${key}`, {
      code: 'CONFIG_INVALID',
      hint: `Known keys: ${KNOWN_CONFIG_KEYS.join(', ')}`,
    });
  }
  const parts = key.split('.');
  let cur: unknown = cfg;
  for (const p of parts) {
    if (cur === undefined || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

/**
 * Return a new config object with `key` set to `raw`. `raw` is coerced to the
 * right primitive based on the key (numbers for numeric keys, strings for the
 * rest). The result is validated through the schema before being returned —
 * invalid combinations (e.g. `budget_usd = -1`) throw `CONFIG_INVALID`.
 */
export function setByDottedKey(cfg: UafConfig, key: string, raw: string): UafConfig {
  if (!isKnownConfigKey(key)) {
    throw new UafError(`unknown config key: ${key}`, {
      code: 'CONFIG_INVALID',
      hint: `Known keys: ${KNOWN_CONFIG_KEYS.join(', ')}`,
    });
  }
  const value = (SCALAR_COERCE[key] ?? ((s: string) => s))(raw);

  const next = structuredCopy(cfg);
  const parts = key.split('.');
  let cur: Record<string, unknown> = next as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const p = parts[i]!;
    if (typeof cur[p] !== 'object' || cur[p] === null) cur[p] = {};
    cur = cur[p] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;

  const parsed = UafConfigSchema.safeParse(next);
  if (!parsed.success) {
    throw new UafError(`invalid value for ${key}`, {
      code: 'CONFIG_INVALID',
      details: { issues: formatZodIssues(parsed.error), value: raw },
    });
  }
  return parsed.data;
}

function structuredCopy<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/** Serialize a config to YAML and write it, creating the parent dir if needed. */
export async function writeConfigFile(path: string, cfg: UafConfig): Promise<void> {
  try {
    await mkdir(dirname(path), { recursive: true });
    const body = yamlStringify(cfg, { indent: 2 });
    await writeFile(path, body, 'utf8');
  } catch (err) {
    throw new UafError(`failed to write config file: ${path}`, {
      code: 'CONFIG_WRITE_FAILED',
      cause: err,
      logPath: path,
    });
  }
}

// ---------------------------------------------------------------------------
// Workspace-location resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the effective workspace directory. `undefined` config value means
 * "./workspace from repoRoot" (Phase 6 behavior). Absolute paths pass through.
 * `~` at the start is expanded to the user's home.
 */
export function resolveWorkspaceDir(cfg: UafConfig, repoRoot: string, home?: string): string {
  const loc = cfg.workspace_location;
  if (!loc) return join(repoRoot, 'workspace');
  const h = home ?? homedir();
  const expanded = loc.startsWith('~') ? join(h, loc.slice(1).replace(/^[\\/]/, '')) : loc;
  return isAbsolute(expanded) ? expanded : resolve(repoRoot, expanded);
}

// Re-exports so consumers have one barrel to import from.
export type { UafConfig, ConfigKey };
export { KNOWN_CONFIG_KEYS, isKnownConfigKey };
