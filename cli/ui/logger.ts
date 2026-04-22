/**
 * User-facing console output for the uaf CLI.
 *
 * This is intentionally separate from `core/logger.ts` (pino-based structured
 * logging for agent metrics). The CLI logger writes human-readable messages to
 * stderr (so stdout stays clean for parseable output like `uaf list --json`),
 * with optional coloring and a verbose mode that toggles debug lines.
 */
import { colors, symbols } from './colors.js';

export interface CliLoggerOptions {
  verbose?: boolean;
  /** Destination stream. Defaults to process.stderr. */
  stream?: NodeJS.WriteStream;
}

export interface CliLogger {
  verbose: boolean;
  info(msg: string): void;
  success(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  debug(msg: string): void;
  /** Print a line with no prefix. Use sparingly — prefer info/success/warn. */
  raw(msg: string): void;
}

export function createCliLogger(opts: CliLoggerOptions = {}): CliLogger {
  const stream = opts.stream ?? process.stderr;
  const write = (line: string): void => {
    stream.write(line + '\n');
  };
  const verbose = opts.verbose ?? false;

  return {
    verbose,
    info(msg) {
      write(`${colors.blue(symbols.info)} ${msg}`);
    },
    success(msg) {
      write(`${colors.green(symbols.ok)} ${msg}`);
    },
    warn(msg) {
      write(`${colors.yellow(symbols.warn)} ${msg}`);
    },
    error(msg) {
      write(`${colors.red(symbols.fail)} ${msg}`);
    },
    debug(msg) {
      if (!verbose) return;
      write(`${colors.dim('· ' + msg)}`);
    },
    raw(msg) {
      write(msg);
    },
  };
}

/** No-op logger for tests. */
export const nullCliLogger: CliLogger = {
  verbose: false,
  info: () => undefined,
  success: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  raw: () => undefined,
};
