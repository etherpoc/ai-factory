/**
 * Parse human-friendly durations like `7d`, `2w`, `1m`, `30s`, `3h` into
 * milliseconds. Used by `uaf clean --older-than`.
 */
import { UafError } from '../ui/errors.js';

const UNITS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 60 * 60_000,
  d: 24 * 60 * 60_000,
  w: 7 * 24 * 60 * 60_000,
  /** Treat "M" as 30 days; "mo" would be clearer but this matches the spec example. */
  M: 30 * 24 * 60 * 60_000,
};

/** `parseDuration('7d')` → 604800000 ms. Throws UafError on bad input. */
export function parseDuration(input: string): number {
  const match = /^(\d+)(s|m|h|d|w|M|mo)$/.exec(input.trim());
  if (!match) {
    throw new UafError(`cannot parse duration: "${input}"`, {
      code: 'CONFIG_INVALID',
      hint: 'Expected forms: 30s, 15m, 2h, 7d, 2w, 1M (M = 30 days).',
    });
  }
  const n = Number.parseInt(match[1]!, 10);
  const suffix = match[2]!;
  const unit = suffix === 'mo' ? UNITS.M! : UNITS[suffix]!;
  return n * unit;
}

/** Pretty-print a millisecond duration as "5d 3h" or "12m". */
export function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 60 * 60_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 24 * 60 * 60_000) return `${Math.round(ms / (60 * 60_000))}h`;
  const days = Math.floor(ms / (24 * 60 * 60_000));
  const hours = Math.round((ms - days * 24 * 60 * 60_000) / (60 * 60_000));
  return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
}
