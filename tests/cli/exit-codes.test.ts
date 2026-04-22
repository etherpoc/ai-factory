/**
 * Phase 7.1 regression: exit-code policy.
 *
 * This test locks the code → exit-number mapping so Phase 9 (CI) can rely on
 * specific exit codes for branching ("fail the pipeline on runtime error but
 * keep going on env error", etc).
 */
import { describe, it, expect } from 'vitest';
import { EXIT_CODES, exitCodeFor } from '../../cli/ui/exit-codes.js';
import { UafError } from '../../cli/ui/errors.js';

describe('cli/ui/exit-codes', () => {
  it('NOT_IMPLEMENTED maps to 3', () => {
    const err = new UafError('x', { code: 'NOT_IMPLEMENTED' });
    expect(exitCodeFor(err)).toBe(EXIT_CODES.NOT_IMPLEMENTED);
    expect(exitCodeFor(err)).toBe(3);
  });

  it('BUDGET_EXCEEDED maps to RUNTIME_ERROR (5)', () => {
    const err = new UafError('x', { code: 'BUDGET_EXCEEDED' });
    expect(exitCodeFor(err)).toBe(EXIT_CODES.RUNTIME_ERROR);
    expect(exitCodeFor(err)).toBe(5);
  });

  it('CONFIG_INVALID maps to CONFIG_ERROR (4)', () => {
    const err = new UafError('x', { code: 'CONFIG_INVALID' });
    expect(exitCodeFor(err)).toBe(EXIT_CODES.CONFIG_ERROR);
  });

  it('API_KEY_MISSING maps to ENV_ERROR (6)', () => {
    const err = new UafError('x', { code: 'API_KEY_MISSING' });
    expect(exitCodeFor(err)).toBe(EXIT_CODES.ENV_ERROR);
  });

  it('PROJECT_NOT_FOUND maps to NOT_FOUND (7)', () => {
    const err = new UafError('x', { code: 'PROJECT_NOT_FOUND' });
    expect(exitCodeFor(err)).toBe(EXIT_CODES.NOT_FOUND);
  });

  it('USER_ABORT maps to USER_ABORT (8)', () => {
    const err = new UafError('x', { code: 'USER_ABORT' });
    expect(exitCodeFor(err)).toBe(EXIT_CODES.USER_ABORT);
  });

  it('unknown code falls through to GENERIC (1)', () => {
    const err = new UafError('x', { code: 'SOMETHING_NEW' });
    expect(exitCodeFor(err)).toBe(EXIT_CODES.GENERIC);
  });

  it('no code also falls through to GENERIC (1)', () => {
    const err = new UafError('x');
    expect(exitCodeFor(err)).toBe(EXIT_CODES.GENERIC);
  });

  it('plain Error maps to GENERIC (1)', () => {
    expect(exitCodeFor(new Error('kaboom'))).toBe(EXIT_CODES.GENERIC);
  });

  it('non-Error values map to GENERIC (1)', () => {
    expect(exitCodeFor('kaboom')).toBe(EXIT_CODES.GENERIC);
    expect(exitCodeFor(undefined)).toBe(EXIT_CODES.GENERIC);
    expect(exitCodeFor(null)).toBe(EXIT_CODES.GENERIC);
  });

  it('details.exitCode overrides the code mapping', () => {
    const err = new UafError('x', {
      code: 'NOT_IMPLEMENTED',
      details: { exitCode: 42 },
    });
    expect(exitCodeFor(err)).toBe(42);
  });

  it('EXIT_CODES values match the documented policy', () => {
    // Lock-in: if any of these change, downstream CI scripts break.
    expect(EXIT_CODES.SUCCESS).toBe(0);
    expect(EXIT_CODES.GENERIC).toBe(1);
    expect(EXIT_CODES.ARG_ERROR).toBe(2);
    expect(EXIT_CODES.NOT_IMPLEMENTED).toBe(3);
    expect(EXIT_CODES.CONFIG_ERROR).toBe(4);
    expect(EXIT_CODES.RUNTIME_ERROR).toBe(5);
    expect(EXIT_CODES.ENV_ERROR).toBe(6);
    expect(EXIT_CODES.NOT_FOUND).toBe(7);
    expect(EXIT_CODES.USER_ABORT).toBe(8);
  });
});
