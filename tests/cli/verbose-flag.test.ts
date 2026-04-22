/**
 * Regression: `--verbose` works in either position.
 *
 * Exercises `main()` through an invalid `config set` to trigger a known,
 * hermetic error path (no stdin, no network). Both prefix and suffix
 * placement of --verbose must produce identical verbose output.
 */
import { describe, it, expect } from 'vitest';
import { main } from '../../cli/index.js';

function captureStream(): {
  stream: NodeJS.WriteStream;
  written: () => string;
} {
  const chunks: string[] = [];
  const stream = {
    write(chunk: string | Uint8Array): boolean {
      chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    },
  } as unknown as NodeJS.WriteStream;
  return { stream, written: () => chunks.join('') };
}

function plain(s: string): string {
  return s.replace(/\x1B\[[0-9;]*m/g, '');
}

// Pick a UafError code that:
//   1. happens deterministically with no external deps
//   2. only appears in the verbose output (not the short one)
//   3. exits with a stable code
const TRIGGER = ['config', 'set', 'not-a-key', 'value'];
const EXPECTED_CODE_SUBSTR = 'CONFIG_INVALID';
const EXPECTED_EXIT = 4;

async function capture(argv: string[]): Promise<{ code: number; out: string }> {
  const { stream, written } = captureStream();
  const origStderr = process.stderr.write.bind(process.stderr);
  process.stderr.write = stream.write.bind(stream);
  let code: number;
  try {
    code = await main(['node', 'uaf', ...argv]);
  } finally {
    process.stderr.write = origStderr;
  }
  return { code, out: plain(written()) };
}

describe('cli — --verbose flag positioning', () => {
  it('prefix position: `uaf --verbose <cmd>` enables verbose', async () => {
    const { code, out } = await capture(['--verbose', ...TRIGGER]);
    expect(code).toBe(EXPECTED_EXIT);
    expect(out).toContain(EXPECTED_CODE_SUBSTR);
  });

  it('suffix position: `uaf <cmd> --verbose` enables verbose', async () => {
    const { code, out } = await capture([...TRIGGER, '--verbose']);
    expect(code).toBe(EXPECTED_EXIT);
    expect(out).toContain(EXPECTED_CODE_SUBSTR);
  });

  it('no --verbose: verbose details are hidden', async () => {
    const { code, out } = await capture(TRIGGER);
    expect(code).toBe(EXPECTED_EXIT);
    expect(out).not.toContain(EXPECTED_CODE_SUBSTR);
    expect(out).toContain('詳細を見る: --verbose で再実行');
  });
});
