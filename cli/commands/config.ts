/**
 * `uaf config` — read and write configuration.
 *
 * Subcommands: get / set / list / edit. Implementation hands off to
 * cli/config/loader.ts for the actual reading / writing / merging. This file
 * is just UI glue.
 */
import { stringify as yamlStringify } from 'yaml';
import {
  fileExists,
  getByDottedKey,
  KNOWN_CONFIG_KEYS,
  loadEffectiveConfig,
  readConfigFile,
  resolveConfigPaths,
  setByDottedKey,
  writeConfigFile,
  type UafConfig,
} from '../config/loader.js';
import { colors, symbols } from '../ui/colors.js';
import { UafError } from '../ui/errors.js';
import { openInEditor, resolveEditor } from '../utils/editor.js';

export interface ConfigScopeOptions {
  global?: boolean;
  project?: boolean;
}
export interface ConfigGetOptions extends ConfigScopeOptions {
  key: string;
}
export interface ConfigSetOptions extends ConfigScopeOptions {
  key: string;
  value: string;
}
export interface ConfigListOptions {
  json?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function scopePath(opts: ConfigScopeOptions): 'global' | 'project' {
  if (opts.project && opts.global) {
    throw new UafError('cannot combine --global and --project', { code: 'ARG_MISSING' });
  }
  if (opts.project) return 'project';
  return 'global';
}

function validateKey(key: string): void {
  const known = (KNOWN_CONFIG_KEYS as readonly string[]).includes(key);
  if (!known) {
    throw new UafError(`unknown config key: ${key}`, {
      code: 'CONFIG_INVALID',
      hint: `Known keys: ${KNOWN_CONFIG_KEYS.join(', ')}`,
    });
  }
}

// ---------------------------------------------------------------------------
// get
// ---------------------------------------------------------------------------

export async function runConfigGet(opts: ConfigGetOptions, _global: unknown = {}): Promise<void> {
  validateKey(opts.key);
  const scopeOpt = opts.global || opts.project;
  const eff = await loadEffectiveConfig({
    ...(opts.project && !opts.global ? { skipGlobal: true } : {}),
    ...(opts.global && !opts.project ? { skipProject: true } : {}),
  });
  const src = scopeOpt
    ? opts.project
      ? eff.sources.project ?? {}
      : eff.sources.global ?? {}
    : eff.effective;
  const value = getByDottedKey(src, opts.key);
  if (value === undefined) {
    process.stdout.write('(not set)\n');
    return;
  }
  process.stdout.write(stringifyValue(value) + '\n');
}

// ---------------------------------------------------------------------------
// set
// ---------------------------------------------------------------------------

export async function runConfigSet(opts: ConfigSetOptions, _global: unknown = {}): Promise<void> {
  validateKey(opts.key);
  const scope = scopePath(opts);
  const paths = resolveConfigPaths();
  const target = scope === 'global' ? paths.global : paths.project;

  // Read existing layer (not the merged config) so we only write back what
  // this scope owns.
  const existing = (await readConfigFile(target)) ?? {};
  const updated = setByDottedKey(existing, opts.key, opts.value);
  await writeConfigFile(target, updated);

  process.stderr.write(
    `${colors.green(symbols.ok)} wrote ${opts.key} = ${opts.value} to ${target}\n`,
  );
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

export async function runConfigList(opts: ConfigListOptions = {}, _global: unknown = {}): Promise<void> {
  const eff = await loadEffectiveConfig();
  if (opts.json) {
    process.stdout.write(
      JSON.stringify(
        {
          effective: eff.effective,
          sources: eff.sources,
          paths: eff.paths,
        },
        null,
        2,
      ) + '\n',
    );
    return;
  }
  const out: string[] = [];
  out.push(colors.bold('=== uaf config (effective) ==='));
  out.push(yamlStringify(eff.effective, { indent: 2 }).trimEnd());
  out.push('');
  out.push(colors.dim(`global:  ${eff.paths.global}${eff.sources.global ? '' : ' (not present)'}`));
  out.push(colors.dim(`project: ${eff.paths.project}${eff.sources.project ? '' : ' (not present)'}`));
  process.stdout.write(out.join('\n') + '\n');
}

// ---------------------------------------------------------------------------
// edit
// ---------------------------------------------------------------------------

export async function runConfigEdit(opts: ConfigScopeOptions = {}, _global: unknown = {}): Promise<void> {
  const scope = scopePath(opts);
  const paths = resolveConfigPaths();
  const target = scope === 'global' ? paths.global : paths.project;
  const eff = await loadEffectiveConfig();
  const editor = resolveEditor(undefined, eff.effective.editor);

  // Create the file with an empty YAML if it doesn't exist — editors need
  // somewhere to land.
  if (!(await fileExists(target))) {
    await writeConfigFile(target, {} as UafConfig);
  }
  await openInEditor(editor, target);
  process.stderr.write(`${colors.green(symbols.ok)} edited ${target}\n`);
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

function stringifyValue(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || v === null) return String(v);
  return JSON.stringify(v, null, 2);
}
