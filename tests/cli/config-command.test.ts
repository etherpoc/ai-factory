/**
 * Phase 7.7 integration tests for `uaf config` subcommands.
 *
 * We use HOME override (process.env.HOME / USERPROFILE) so the test doesn't
 * pollute the developer's real ~/.uaf/config.yaml.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runConfigGet,
  runConfigList,
  runConfigSet,
} from '../../cli/commands/config.js';
import { UafError } from '../../cli/ui/errors.js';

let tmp: string;
let savedCwd: string;
let savedHome: string | undefined;
let savedUserprofile: string | undefined;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'uaf-cfg-'));
  const home = join(tmp, 'home');
  await mkdir(home, { recursive: true });
  await mkdir(join(tmp, 'project'), { recursive: true });
  savedCwd = process.cwd();
  savedHome = process.env.HOME;
  savedUserprofile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.chdir(join(tmp, 'project'));
});
afterEach(async () => {
  process.chdir(savedCwd);
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  if (savedUserprofile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = savedUserprofile;
  await rm(tmp, { recursive: true, force: true });
});

function captureStdout(): { written: () => string; restore: () => void } {
  const chunks: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.stdout.write as any) = (chunk: string | Uint8Array): boolean => {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  };
  return {
    written: () => chunks.join(''),
    restore: () => {
      process.stdout.write = orig;
    },
  };
}

describe('uaf config — integration', () => {
  it('set writes to ~/.uaf/config.yaml by default', async () => {
    await runConfigSet({ key: 'budget_usd', value: '1.5' });
    const written = await readFile(join(tmp, 'home', '.uaf', 'config.yaml'), 'utf8');
    expect(written).toMatch(/budget_usd:\s*1\.5/);
  });

  it('set --project writes to ./.uafrc', async () => {
    await runConfigSet({ key: 'max_iterations', value: '5', project: true });
    const written = await readFile(join(tmp, 'project', '.uafrc'), 'utf8');
    expect(written).toMatch(/max_iterations:\s*5/);
  });

  it('get returns the value after set (round-trip)', async () => {
    await runConfigSet({ key: 'budget_usd', value: '0.75' });
    const cap = captureStdout();
    try {
      await runConfigGet({ key: 'budget_usd' });
    } finally {
      cap.restore();
    }
    expect(cap.written().trim()).toBe('0.75');
  });

  it('get on unknown key → CONFIG_INVALID', async () => {
    const err = (await runConfigGet({ key: 'nope' }).catch((e) => e)) as unknown;
    expect(err).toBeInstanceOf(UafError);
    expect((err as UafError).code).toBe('CONFIG_INVALID');
  });

  it('set on unknown key → CONFIG_INVALID', async () => {
    const err = (await runConfigSet({ key: 'nope', value: 'x' }).catch((e) => e)) as unknown;
    expect(err).toBeInstanceOf(UafError);
    expect((err as UafError).code).toBe('CONFIG_INVALID');
  });

  it('list emits the merged config', async () => {
    await runConfigSet({ key: 'budget_usd', value: '2.5' });
    const cap = captureStdout();
    try {
      await runConfigList({});
    } finally {
      cap.restore();
    }
    expect(cap.written()).toMatch(/budget_usd:\s*2\.5/);
  });

  it('list --json emits structured output', async () => {
    await runConfigSet({ key: 'budget_usd', value: '0.9' });
    const cap = captureStdout();
    try {
      await runConfigList({ json: true });
    } finally {
      cap.restore();
    }
    const data = JSON.parse(cap.written()) as { effective: { budget_usd: number } };
    expect(data.effective.budget_usd).toBe(0.9);
  });

  it('project config wins over global (merge precedence)', async () => {
    await runConfigSet({ key: 'budget_usd', value: '1' }); // global
    await runConfigSet({ key: 'budget_usd', value: '0.25', project: true });
    const cap = captureStdout();
    try {
      await runConfigGet({ key: 'budget_usd' });
    } finally {
      cap.restore();
    }
    expect(cap.written().trim()).toBe('0.25');
  });
});
