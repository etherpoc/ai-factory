/**
 * Error presentation for the uaf CLI.
 *
 * Two modes (per Phase 7 spec lines 369-410):
 *
 *   default — short, actionable message with a hint. Keeps output usable for
 *             humans who just want to know what to do next.
 *   verbose — full error with cause chain, stack trace, and extra context.
 *
 * Commands throw `UafError` (or anything else) and let the top-level handler
 * in `cli/index.ts` format the output using `formatError` + `printError`.
 */
import { colors, symbols } from './colors.js';
import type { CliLogger } from './logger.js';

export interface UafErrorDetails {
  /** Short machine-readable kind. Shown in verbose mode. */
  code?: string;
  /** Extra structured context shown in verbose mode. */
  details?: Record<string, unknown>;
  /** Short human-readable next step. Shown in default mode. */
  hint?: string;
  /** Optional pointer to a log file or artefact for further investigation. */
  logPath?: string;
  /** The underlying error, if any. Stack is shown only in verbose mode. */
  cause?: unknown;
}

/**
 * Structured error thrown by uaf commands. When the top-level handler catches
 * one of these, it uses `formatError` to produce a short message (or full
 * detail when `--verbose` is set).
 */
export class UafError extends Error {
  readonly code?: string;
  readonly details?: Record<string, unknown>;
  readonly hint?: string;
  readonly logPath?: string;

  constructor(message: string, d: UafErrorDetails = {}) {
    super(message, d.cause ? { cause: d.cause } : undefined);
    this.name = 'UafError';
    if (d.code) this.code = d.code;
    if (d.details) this.details = d.details;
    if (d.hint) this.hint = d.hint;
    if (d.logPath) this.logPath = d.logPath;
  }
}

/**
 * Render an error as lines to print. Caller chooses the stream (usually
 * stderr). Keeps the string-assembly separate from the actual writes so it is
 * testable.
 */
export function formatError(err: unknown, verbose: boolean): string[] {
  const lines: string[] = [];
  const prefix = colors.red(symbols.fail);

  if (err instanceof UafError) {
    lines.push(`${prefix} ${err.message}`);
    lines.push('');
    if (err.hint) {
      lines.push(`  ${colors.bold('対処:')} ${err.hint}`);
    }
    if (verbose) {
      if (err.code) lines.push(`  ${colors.bold('コード:')} ${err.code}`);
      if (err.details) {
        lines.push(`  ${colors.bold('詳細:')}`);
        for (const [k, v] of Object.entries(err.details)) {
          lines.push(`    ${colors.dim(k)}: ${stringify(v)}`);
        }
      }
      if (err.cause instanceof Error && err.cause.stack) {
        lines.push('');
        lines.push(colors.dim('  原因:'));
        for (const line of err.cause.stack.split('\n')) {
          lines.push(colors.dim('    ' + line));
        }
      }
    }
    if (err.logPath) {
      lines.push('');
      lines.push(`  ${colors.dim('ログ: ' + err.logPath)}`);
    }
    if (!verbose) {
      lines.push('');
      lines.push(`  ${colors.dim('詳細を見る: --verbose で再実行')}`);
    }
    return lines;
  }

  // Unknown / standard errors
  if (err instanceof Error) {
    lines.push(`${prefix} ${err.message || 'unknown error'}`);
    if (verbose && err.stack) {
      lines.push('');
      for (const line of err.stack.split('\n')) {
        lines.push(colors.dim('  ' + line));
      }
    } else {
      lines.push('');
      lines.push(`  ${colors.dim('詳細を見る: --verbose で再実行')}`);
    }
    return lines;
  }

  lines.push(`${prefix} ${String(err)}`);
  return lines;
}

export function printError(err: unknown, logger: CliLogger): void {
  for (const line of formatError(err, logger.verbose)) {
    logger.raw(line);
  }
}

function stringify(v: unknown): string {
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
