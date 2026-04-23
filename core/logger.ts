/**
 * Structured logging via pino.
 *
 * Two modes:
 *
 *   1. Legacy (no `filePath`): pretty output to stderr via `pino-pretty`
 *      transport. Unchanged from the original behavior — used by scripts,
 *      tests, and any caller that doesn't opt into file routing.
 *
 *   2. File-routing mode (`filePath` set, Phase 7.8.10): line-delimited JSON
 *      written to the log file via `pino.multistream` with synchronous
 *      destinations. Optionally also mirrored to stderr as JSON when
 *      `streamToConsole` is true. This is what `uaf create` / `uaf resume`
 *      use so the interactive UI and the log stream don't compete for the
 *      terminal.
 *
 *      Default `streamToConsole` when `filePath` is set:
 *        - stderr IS a TTY (interactive session)     → false (silence)
 *        - stderr IS NOT a TTY (CI, piped, script)   → true  (don't hide
 *          output in a file that nobody will look at)
 *      `--log-stream` flips this to `true` explicitly.
 *
 *   The raw JSON file is what `uaf logs <proj-id>` prettifies on demand.
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import pino from 'pino';
import type { Logger } from './types.js';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

export interface LoggerOptions {
  name: string;
  level?: LogLevel;
  /**
   * Pretty-print to stderr (legacy path, no `filePath`). Default: true when
   * `NODE_ENV !== 'production'`. Ignored when `filePath` is set (the
   * file-routing mode always writes JSON).
   */
  pretty?: boolean;
  /**
   * Phase 7.8.10: route logs to this file (line-delimited JSON). Directory
   * is auto-created. When set, the "legacy pino-pretty on stderr" path is
   * turned off — stderr either gets raw JSON (if `streamToConsole`) or
   * nothing at all.
   */
  filePath?: string;
  /**
   * Phase 7.8.10: when `filePath` is set, also mirror JSON lines to stderr.
   * Default auto-detects based on `process.stderr.isTTY` (see module doc).
   * No-op when `filePath` is not set.
   */
  streamToConsole?: boolean;
}

export function createLogger(opts: LoggerOptions): Logger {
  const level: LogLevel =
    opts.level ?? (process.env.UAF_LOG_LEVEL as LogLevel | undefined) ?? 'info';

  if (opts.filePath) {
    return createFileRoutedLogger(opts.name, level, opts.filePath, opts.streamToConsole);
  }

  // Legacy path (unchanged) — pretty to stderr via transport.
  const pretty = opts.pretty ?? process.env.NODE_ENV !== 'production';
  const base = pino({
    name: opts.name,
    level,
    transport: pretty
      ? {
          target: 'pino-pretty',
          options: { destination: 2, colorize: true, translateTime: 'HH:MM:ss.l' },
        }
      : undefined,
  });

  return wrap(base);
}

function createFileRoutedLogger(
  name: string,
  level: LogLevel,
  filePath: string,
  streamToConsoleOpt: boolean | undefined,
): Logger {
  // Auto-detect: silent stderr when attached to a TTY (interactive), stream
  // otherwise. Callers override via --log-stream → streamToConsole=true.
  const streamToConsole = streamToConsoleOpt ?? !process.stderr.isTTY;

  // Ensure the parent directory exists BEFORE pino opens the file. Using
  // mkdirSync is fine here — logger setup runs once per command.
  try {
    mkdirSync(dirname(filePath), { recursive: true });
  } catch {
    // Best-effort: if we can't create the dir, pino.destination will throw
    // below and the caller will see a clear error.
  }

  const fileStream = pino.destination({ dest: filePath, sync: true, mkdir: true });
  const streams: pino.StreamEntry<LogLevel>[] = [{ level, stream: fileStream }];
  if (streamToConsole) {
    // stderr as a JSON sink. Users who want pretty can run
    // `uaf logs <proj-id>` after the fact.
    streams.push({ level, stream: pino.destination({ dest: 2, sync: true }) });
  }

  const base = pino({ name, level }, pino.multistream(streams));
  return wrap(base);
}

function wrap(base: pino.Logger): Logger {
  return {
    trace: (msg, data) => base.trace(data ?? {}, msg),
    debug: (msg, data) => base.debug(data ?? {}, msg),
    info: (msg, data) => base.info(data ?? {}, msg),
    warn: (msg, data) => base.warn(data ?? {}, msg),
    error: (msg, data) => base.error(data ?? {}, msg),
  };
}

/** Logger that discards everything — useful for tests. */
export const nullLogger: Logger = {
  trace: () => undefined,
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
