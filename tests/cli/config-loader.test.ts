/**
 * Phase 7.2 regression — loader.
 *
 * Covers: path resolution, precedence (project > global > defaults), deep
 * merge of `models`, error surfacing (CONFIG_PARSE_ERROR / CONFIG_INVALID),
 * dotted get/set, YAML round-trip, and workspace-location expansion.
 *
 * Every filesystem test uses a per-test tmp directory under os.tmpdir() so
 * parallelism is safe.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { UafError } from '../../cli/ui/errors.js';
import {
  fileExists,
  getByDottedKey,
  loadEffectiveConfig,
  mergeConfigs,
  readConfigFile,
  resolveConfigPaths,
  resolveWorkspaceDir,
  setByDottedKey,
  writeConfigFile,
} from '../../cli/config/loader.js';
import { BUILT_IN_DEFAULTS, CONFIG_FILES } from '../../cli/config/defaults.js';

let tmp: string;
let home: string;
let cwd: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'uaf-config-'));
  home = join(tmp, 'home');
  cwd = join(tmp, 'project');
  await mkdir(home, { recursive: true });
  await mkdir(cwd, { recursive: true });
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('cli/config/loader — paths', () => {
  it('resolveConfigPaths joins with home and cwd', () => {
    const p = resolveConfigPaths({ home, cwd });
    expect(p.global).toBe(join(home, CONFIG_FILES.global));
    expect(p.project).toBe(join(cwd, CONFIG_FILES.project));
  });

  it('fileExists distinguishes missing vs present', async () => {
    expect(await fileExists(join(cwd, 'nope'))).toBe(false);
    await writeFile(join(cwd, 'here'), 'x');
    expect(await fileExists(join(cwd, 'here'))).toBe(true);
  });
});

describe('cli/config/loader — readConfigFile', () => {
  it('returns null for a missing file', async () => {
    const out = await readConfigFile(join(cwd, 'missing.yaml'));
    expect(out).toBeNull();
  });

  it('returns an empty object for an empty file', async () => {
    const p = join(cwd, 'empty.yaml');
    await writeFile(p, '');
    const out = await readConfigFile(p);
    expect(out).toEqual({});
  });

  it('returns an empty object for a `---`-only file', async () => {
    const p = join(cwd, 'nullish.yaml');
    await writeFile(p, '---\n');
    const out = await readConfigFile(p);
    expect(out).toEqual({});
  });

  it('parses a valid config', async () => {
    const p = join(cwd, 'valid.yaml');
    await writeFile(
      p,
      ['budget_usd: 1.5', 'models:', '  programmer: claude-sonnet-4-6'].join('\n'),
    );
    const out = await readConfigFile(p);
    expect(out).toEqual({
      budget_usd: 1.5,
      models: { programmer: 'claude-sonnet-4-6' },
    });
  });

  it('throws CONFIG_PARSE_ERROR on malformed YAML', async () => {
    const p = join(cwd, 'bad.yaml');
    await writeFile(p, '{{not-yaml');
    const err = await readConfigFile(p).catch((e) => e);
    expect(err).toBeInstanceOf(UafError);
    expect((err as UafError).code).toBe('CONFIG_PARSE_ERROR');
  });

  it('throws CONFIG_INVALID for a YAML array at top level', async () => {
    const p = join(cwd, 'array.yaml');
    await writeFile(p, '- 1\n- 2\n');
    const err = await readConfigFile(p).catch((e) => e);
    expect(err).toBeInstanceOf(UafError);
    expect((err as UafError).code).toBe('CONFIG_INVALID');
  });

  it('throws CONFIG_INVALID on unknown keys (strict)', async () => {
    const p = join(cwd, 'extra.yaml');
    await writeFile(p, 'totally_not_a_key: 1\n');
    const err = await readConfigFile(p).catch((e) => e);
    expect(err).toBeInstanceOf(UafError);
    expect((err as UafError).code).toBe('CONFIG_INVALID');
  });

  it('throws CONFIG_INVALID on negative budget', async () => {
    const p = join(cwd, 'neg.yaml');
    await writeFile(p, 'budget_usd: -1\n');
    const err = await readConfigFile(p).catch((e) => e);
    expect(err).toBeInstanceOf(UafError);
    expect((err as UafError).code).toBe('CONFIG_INVALID');
  });
});

describe('cli/config/loader — mergeConfigs', () => {
  it('defaults always contribute', () => {
    const m = mergeConfigs();
    expect(m.budget_usd).toBe(BUILT_IN_DEFAULTS.budget_usd);
    expect(m.max_iterations).toBe(BUILT_IN_DEFAULTS.max_iterations);
  });

  it('later layers override earlier ones (scalars)', () => {
    const m = mergeConfigs({ budget_usd: 1 }, { budget_usd: 2 });
    expect(m.budget_usd).toBe(2);
  });

  it('models deep-merges by role', () => {
    const m = mergeConfigs(
      { models: { programmer: 'a', tester: 'b' } },
      { models: { tester: 'c' } },
    );
    expect(m.models).toEqual({ programmer: 'a', tester: 'c' });
  });

  it('classifier deep-merges', () => {
    const m = mergeConfigs(
      { classifier: { default_type: 'x' } },
      { classifier: { default_type: 'y' } },
    );
    expect(m.classifier).toEqual({ default_type: 'y' });
  });

  it('undefined layers are ignored', () => {
    const m = mergeConfigs(null, undefined, { budget_usd: 5 });
    expect(m.budget_usd).toBe(5);
  });
});

describe('cli/config/loader — loadEffectiveConfig', () => {
  it('returns defaults when nothing is on disk', async () => {
    const { effective, sources } = await loadEffectiveConfig({ home, cwd });
    expect(effective.budget_usd).toBe(BUILT_IN_DEFAULTS.budget_usd);
    expect(sources.global).toBeUndefined();
    expect(sources.project).toBeUndefined();
    expect(sources.defaults).toBeDefined();
  });

  it('project > global > defaults precedence', async () => {
    await mkdir(join(home, '.uaf'), { recursive: true });
    await writeFile(
      join(home, '.uaf', 'config.yaml'),
      'budget_usd: 3.0\nmax_iterations: 5\n',
    );
    await writeFile(join(cwd, '.uafrc'), 'budget_usd: 1.0\n');
    const { effective, sources } = await loadEffectiveConfig({ home, cwd });
    expect(effective.budget_usd).toBe(1.0); // project wins
    expect(effective.max_iterations).toBe(5); // global fills in
    expect(sources.global).toBeDefined();
    expect(sources.project).toBeDefined();
  });

  it('skipGlobal bypasses the global file', async () => {
    await mkdir(join(home, '.uaf'), { recursive: true });
    await writeFile(join(home, '.uaf', 'config.yaml'), 'budget_usd: 3.0\n');
    const { sources } = await loadEffectiveConfig({ home, cwd, skipGlobal: true });
    expect(sources.global).toBeUndefined();
  });

  it('skipProject bypasses the project file', async () => {
    await writeFile(join(cwd, '.uafrc'), 'budget_usd: 3.0\n');
    const { sources } = await loadEffectiveConfig({ home, cwd, skipProject: true });
    expect(sources.project).toBeUndefined();
  });

  it('inject lets tests bypass disk reads', async () => {
    const { effective, sources } = await loadEffectiveConfig({
      home,
      cwd,
      inject: { project: { budget_usd: 7 } },
    });
    expect(effective.budget_usd).toBe(7);
    expect(sources.project).toEqual({ budget_usd: 7 });
  });
});

describe('cli/config/loader — dotted accessors', () => {
  it('getByDottedKey returns a top-level scalar', () => {
    expect(getByDottedKey({ budget_usd: 2 }, 'budget_usd')).toBe(2);
  });

  it('getByDottedKey walks into models', () => {
    const cfg = { models: { programmer: 'X' } };
    expect(getByDottedKey(cfg, 'models.programmer')).toBe('X');
  });

  it('getByDottedKey returns undefined for missing keys', () => {
    expect(getByDottedKey({}, 'budget_usd')).toBeUndefined();
    expect(getByDottedKey({}, 'models.programmer')).toBeUndefined();
  });

  it('getByDottedKey rejects unknown keys', () => {
    const err = (() => {
      try {
        getByDottedKey({}, 'nope');
      } catch (e) {
        return e;
      }
      return null;
    })();
    expect(err).toBeInstanceOf(UafError);
    expect((err as UafError).code).toBe('CONFIG_INVALID');
  });

  it('setByDottedKey coerces budget to number', () => {
    const next = setByDottedKey({}, 'budget_usd', '3.5');
    expect(next.budget_usd).toBe(3.5);
  });

  it('setByDottedKey coerces max_iterations to integer', () => {
    const next = setByDottedKey({}, 'max_iterations', '4');
    expect(next.max_iterations).toBe(4);
  });

  it('setByDottedKey rejects non-integer for iteration caps', () => {
    const err = (() => {
      try {
        setByDottedKey({}, 'max_iterations', '1.5');
      } catch (e) {
        return e;
      }
      return null;
    })();
    expect(err).toBeInstanceOf(UafError);
    expect((err as UafError).code).toBe('CONFIG_INVALID');
  });

  it('setByDottedKey rejects invalid values via schema (e.g. negative budget)', () => {
    const err = (() => {
      try {
        setByDottedKey({}, 'budget_usd', '-1');
      } catch (e) {
        return e;
      }
      return null;
    })();
    expect(err).toBeInstanceOf(UafError);
    expect((err as UafError).code).toBe('CONFIG_INVALID');
  });

  it('setByDottedKey creates the models branch when absent', () => {
    const next = setByDottedKey({}, 'models.programmer', 'claude-sonnet-4-6');
    expect(next.models).toEqual({ programmer: 'claude-sonnet-4-6' });
  });

  it('setByDottedKey preserves other models when updating one role', () => {
    const before = { models: { programmer: 'A', tester: 'B' } };
    const after = setByDottedKey(before, 'models.tester', 'C');
    expect(after.models).toEqual({ programmer: 'A', tester: 'C' });
    // original untouched
    expect(before.models.tester).toBe('B');
  });
});

describe('cli/config/loader — writeConfigFile round-trip', () => {
  it('writes a YAML file and re-reads the same config', async () => {
    const p = join(cwd, '.uafrc');
    const cfg = {
      budget_usd: 1.25,
      models: { programmer: 'claude-sonnet-4-6' },
      classifier: { default_type: '2d-game' },
    };
    await writeConfigFile(p, cfg);
    const readBack = await readConfigFile(p);
    expect(readBack).toEqual(cfg);
  });

  it('creates the parent directory when writing to ~/.uaf/', async () => {
    const p = join(home, '.uaf', 'config.yaml');
    await writeConfigFile(p, { budget_usd: 2 });
    const readBack = await readConfigFile(p);
    expect(readBack).toEqual({ budget_usd: 2 });
  });
});

describe('cli/config/loader — resolveWorkspaceDir', () => {
  // Use tmp as the repoRoot so the assertions stay cross-platform (the drive
  // letter / slash direction is whatever the OS normalizes `tmp` to).
  it('defaults to <repoRoot>/workspace', () => {
    expect(resolveWorkspaceDir({}, tmp)).toBe(join(tmp, 'workspace'));
  });

  it('passes absolute paths through unchanged', () => {
    const abs = join(tmp, 'abs-path');
    expect(resolveWorkspaceDir({ workspace_location: abs }, tmp)).toBe(abs);
  });

  it('expands ~ to home', () => {
    const out = resolveWorkspaceDir(
      { workspace_location: '~/Documents/uaf-workspace' },
      tmp,
      home,
    );
    expect(out).toBe(join(home, 'Documents', 'uaf-workspace'));
  });

  it('resolves relative paths against repoRoot', () => {
    expect(resolveWorkspaceDir({ workspace_location: 'work' }, tmp)).toBe(
      resolve(tmp, 'work'),
    );
  });
});
