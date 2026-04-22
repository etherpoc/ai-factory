/**
 * Phase 7.1 regression tests for cli/ui/errors.ts.
 *
 * - Short mode: hint is shown, stack is hidden, "--verbose で再実行" is shown.
 * - Verbose mode: code + details + cause.stack are included, hint is kept.
 * - Non-UafError Errors are rendered safely and never crash on empty messages.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { UafError, formatError } from '../../cli/ui/errors.js';

// Strip ANSI so assertions are readable.
function plain(lines: string[]): string {
  return lines.join('\n').replace(/\x1B\[[0-9;]*m/g, '');
}

describe('cli/ui/errors — formatError', () => {
  beforeEach(() => {
    // picocolors respects NO_COLOR but the test strips ANSI anyway; belt &
    // braces to keep snapshots stable on developer machines that force color.
    process.env.FORCE_COLOR = '0';
  });

  it('short mode renders hint and suggests --verbose', () => {
    const err = new UafError('generation failed', {
      code: 'SOMETHING',
      hint: 'try --max-rounds 60',
    });
    const out = plain(formatError(err, false));
    expect(out).toContain('generation failed');
    expect(out).toContain('対処: try --max-rounds 60');
    expect(out).toContain('詳細を見る: --verbose で再実行');
    // code must NOT leak in short mode
    expect(out).not.toContain('SOMETHING');
  });

  it('verbose mode includes code, details, and cause stack', () => {
    const cause = new Error('underlying boom');
    const err = new UafError('generation failed', {
      code: 'PHASE_C_EVIDENCE_MISSING',
      details: { missing: 'test evidence', rounds: 45 },
      hint: 'increase rounds',
      cause,
    });
    const out = plain(formatError(err, true));
    expect(out).toContain('generation failed');
    expect(out).toContain('コード: PHASE_C_EVIDENCE_MISSING');
    expect(out).toContain('missing: test evidence');
    expect(out).toContain('rounds: 45');
    expect(out).toContain('対処: increase rounds');
    // verbose mode should include the cause stack
    expect(out).toContain('原因:');
    expect(out).toContain('underlying boom');
  });

  it('renders plain Error without throwing', () => {
    const err = new Error('kaboom');
    const out = plain(formatError(err, false));
    expect(out).toContain('kaboom');
    expect(out).toContain('詳細を見る: --verbose で再実行');
  });

  it('renders plain Error with stack in verbose', () => {
    const err = new Error('kaboom');
    const out = plain(formatError(err, true));
    expect(out).toContain('kaboom');
    // Stack includes the filename of this test, which proves we rendered it.
    expect(out).toMatch(/at /);
  });

  it('falls back to String() for non-Error values', () => {
    const out = plain(formatError('something weird', false));
    expect(out).toContain('something weird');
  });

  it('handles Error with empty message', () => {
    const err = new Error('');
    const out = plain(formatError(err, false));
    expect(out).toContain('unknown error');
  });

  it('logPath is surfaced when provided', () => {
    const err = new UafError('failed', {
      hint: 'check logs',
      logPath: '/tmp/a.log',
    });
    const out = plain(formatError(err, false));
    expect(out).toContain('/tmp/a.log');
  });
});

describe('cli/ui/errors — UafError', () => {
  it('is an instance of Error', () => {
    const err = new UafError('x');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('UafError');
  });

  it('omitting optional fields leaves them undefined', () => {
    const err = new UafError('x');
    expect(err.code).toBeUndefined();
    expect(err.hint).toBeUndefined();
    expect(err.details).toBeUndefined();
  });

  it('stores and exposes provided fields', () => {
    const err = new UafError('x', {
      code: 'C',
      hint: 'H',
      details: { a: 1 },
      logPath: '/p',
    });
    expect(err.code).toBe('C');
    expect(err.hint).toBe('H');
    expect(err.details).toEqual({ a: 1 });
    expect(err.logPath).toBe('/p');
  });

  it('wraps the cause so error.cause is accessible', () => {
    const inner = new Error('inner');
    const err = new UafError('outer', { cause: inner });
    expect(err.cause).toBe(inner);
  });
});
