import { pino } from 'pino';
import type { Logger } from './types.js';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

export interface LoggerOptions {
  name: string;
  level?: LogLevel;
  /** Pretty-print to stderr. Default: true when NODE_ENV !== 'production'. */
  pretty?: boolean;
}

export function createLogger(opts: LoggerOptions): Logger {
  const level: LogLevel =
    opts.level ?? (process.env.UAF_LOG_LEVEL as LogLevel | undefined) ?? 'info';
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
