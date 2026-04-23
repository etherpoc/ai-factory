/**
 * Phase 7.8.10 — core/logger.ts file-routing tests.
 *
 * When `filePath` is set, pino writes line-delimited JSON to that file via
 * a synchronous destination. Auto-creates the parent directory. These tests
 * exercise the file side-effect only (TTY-dependent stderr behavior is
 * covered implicitly by the CI itself being a non-TTY env).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLogger } from '../../core/logger.js';

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'uaf-logger-'));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('createLogger — filePath mode', () => {
  it('writes JSON lines to the log file, auto-creating the logs/ dir', async () => {
    const path = join(tmp, 'logs', 'nested', 'create.log');
    const logger = createLogger({
      name: 'uaf.test',
      filePath: path,
      streamToConsole: false,
    });
    logger.info('hello', { foo: 'bar', n: 7 });
    logger.warn('second line');

    // Sync destination → reads immediately
    const raw = await readFile(path, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);

    const first = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(first.msg).toBe('hello');
    expect(first.foo).toBe('bar');
    expect(first.n).toBe(7);
    expect(first.name).toBe('uaf.test');
    expect(typeof first.time).toBe('number');

    const second = JSON.parse(lines[1]!) as Record<string, unknown>;
    expect(second.msg).toBe('second line');
    expect(second.level).toBe(40); // pino warn = 40
  });

  it('honors UAF_LOG_LEVEL env var', async () => {
    const prev = process.env.UAF_LOG_LEVEL;
    process.env.UAF_LOG_LEVEL = 'warn';
    try {
      const path = join(tmp, 'create.log');
      const logger = createLogger({
        name: 'uaf.test',
        filePath: path,
        streamToConsole: false,
      });
      logger.debug('not shown');
      logger.info('not shown');
      logger.warn('shown');
      logger.error('also shown');

      const raw = await readFile(path, 'utf8');
      const lines = raw.split('\n').filter(Boolean);
      expect(lines).toHaveLength(2);
      const msgs = lines.map((l) => (JSON.parse(l) as { msg: string }).msg);
      expect(msgs).toEqual(['shown', 'also shown']);
    } finally {
      if (prev === undefined) delete process.env.UAF_LOG_LEVEL;
      else process.env.UAF_LOG_LEVEL = prev;
    }
  });
});
