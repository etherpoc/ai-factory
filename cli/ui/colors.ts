/**
 * Minimal picocolors wrapper for the uaf CLI.
 *
 * - Honors NO_COLOR and FORCE_COLOR out of the box (picocolors already does).
 * - Exposes a stable, narrow surface so the rest of the CLI doesn't import
 *   picocolors directly. This makes it easy to swap or mock in tests.
 */
import pc from 'picocolors';

export interface Colors {
  bold(s: string): string;
  dim(s: string): string;
  red(s: string): string;
  green(s: string): string;
  yellow(s: string): string;
  blue(s: string): string;
  cyan(s: string): string;
  magenta(s: string): string;
  gray(s: string): string;
  underline(s: string): string;
}

export const colors: Colors = {
  bold: pc.bold,
  dim: pc.dim,
  red: pc.red,
  green: pc.green,
  yellow: pc.yellow,
  blue: pc.blue,
  cyan: pc.cyan,
  magenta: pc.magenta,
  gray: pc.gray,
  underline: pc.underline,
};

export const symbols = {
  ok: '✓',
  fail: '✗',
  info: 'i',
  warn: '!',
  arrow: '→',
  bullet: '•',
} as const;
