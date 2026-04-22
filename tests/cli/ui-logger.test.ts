/**
 * Phase 7.1 regression tests for cli/ui/logger.ts.
 *
 * - Writes go to the provided stream, not globally to stderr.
 * - Debug output is suppressed unless verbose is true.
 * - Each level prefixes with its symbol.
 */
import { describe, it, expect } from 'vitest';
import { createCliLogger, nullCliLogger } from '../../cli/ui/logger.js';

function plain(s: string): string {
  return s.replace(/\x1B\[[0-9;]*m/g, '');
}

function fakeStream(): { writes: string[]; stream: NodeJS.WriteStream } {
  const writes: string[] = [];
  const stream = {
    write(chunk: string | Uint8Array): boolean {
      writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    },
  } as unknown as NodeJS.WriteStream;
  return { writes, stream };
}

describe('cli/ui/logger', () => {
  it('writes each level with its own symbol', () => {
    const { writes, stream } = fakeStream();
    const log = createCliLogger({ verbose: true, stream });
    log.info('hi');
    log.success('done');
    log.warn('careful');
    log.error('nope');
    const out = plain(writes.join(''));
    expect(out).toContain('i hi');
    expect(out).toContain('✓ done');
    expect(out).toContain('! careful');
    expect(out).toContain('✗ nope');
  });

  it('debug is suppressed when verbose is false', () => {
    const { writes, stream } = fakeStream();
    const log = createCliLogger({ verbose: false, stream });
    log.debug('hidden');
    log.info('visible');
    const out = plain(writes.join(''));
    expect(out).not.toContain('hidden');
    expect(out).toContain('visible');
  });

  it('debug is shown when verbose is true', () => {
    const { writes, stream } = fakeStream();
    const log = createCliLogger({ verbose: true, stream });
    log.debug('shown');
    const out = plain(writes.join(''));
    expect(out).toContain('shown');
  });

  it('raw prints the message with no prefix', () => {
    const { writes, stream } = fakeStream();
    const log = createCliLogger({ verbose: false, stream });
    log.raw('plain');
    const out = plain(writes.join(''));
    expect(out.trim()).toBe('plain');
  });

  it('nullCliLogger swallows every call', () => {
    // Does not throw, does not write anywhere.
    nullCliLogger.info('x');
    nullCliLogger.success('x');
    nullCliLogger.warn('x');
    nullCliLogger.error('x');
    nullCliLogger.debug('x');
    nullCliLogger.raw('x');
    expect(nullCliLogger.verbose).toBe(false);
  });
});
