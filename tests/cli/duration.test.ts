/**
 * Phase 7.5 regression for cli/utils/duration.ts.
 */
import { describe, it, expect } from 'vitest';
import { formatDuration, parseDuration } from '../../cli/utils/duration.js';
import { UafError } from '../../cli/ui/errors.js';

describe('cli/utils/duration — parseDuration', () => {
  it('supports every documented unit', () => {
    expect(parseDuration('30s')).toBe(30_000);
    expect(parseDuration('15m')).toBe(15 * 60_000);
    expect(parseDuration('2h')).toBe(2 * 60 * 60_000);
    expect(parseDuration('7d')).toBe(7 * 24 * 60 * 60_000);
    expect(parseDuration('2w')).toBe(14 * 24 * 60 * 60_000);
    expect(parseDuration('1M')).toBe(30 * 24 * 60 * 60_000);
    expect(parseDuration('1mo')).toBe(30 * 24 * 60 * 60_000);
  });

  it('rejects bad input with CONFIG_INVALID', () => {
    const err = (() => {
      try {
        parseDuration('7xyz');
      } catch (e) {
        return e;
      }
      return null;
    })();
    expect(err).toBeInstanceOf(UafError);
    expect((err as UafError).code).toBe('CONFIG_INVALID');
  });

  it('rejects negative or empty input', () => {
    expect(() => parseDuration('')).toThrow();
    expect(() => parseDuration('-7d')).toThrow();
  });
});

describe('cli/utils/duration — formatDuration', () => {
  it('renders seconds, minutes, hours, days', () => {
    expect(formatDuration(30_000)).toBe('30s');
    expect(formatDuration(90_000)).toBe('2m');
    expect(formatDuration(2 * 60 * 60_000)).toBe('2h');
    expect(formatDuration(2 * 24 * 60 * 60_000)).toBe('2d');
    expect(formatDuration(25 * 60 * 60_000)).toBe('1d 1h');
  });
});
