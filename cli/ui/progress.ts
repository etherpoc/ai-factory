/**
 * Progress reporter — Phase 7.8.10.
 *
 * Human-readable phase / step / task output for long-running CLI commands
 * (`uaf create`, `uaf resume`, `uaf iterate`). Keeps the terminal legible by
 * not interleaving with pino's structured logs (those now go to a log file
 * by default — see `core/logger.ts`).
 *
 * Design notes:
 *
 *   - No ANSI escape games (no live spinners / cursor movement). That keeps
 *     the output copy-pasteable, CI-friendly, and non-destructive when
 *     stderr is a pipe. A task's "in progress" state prints one line; its
 *     completion prints another. The price is slightly more scrollback;
 *     the upside is determinism and trivial tests.
 *
 *   - All output goes to **stderr** so `uaf list --json` and friends still
 *     produce clean stdout.
 *
 *   - Icons / colors gate on `stderr.isTTY` (plus a manual `color` override
 *     for tests). Non-TTY output is plain text — no escape sequences, no
 *     emoji (emoji rendering in CI log viewers is inconsistent).
 */
import { colors } from './colors.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProgressReporterOptions {
  /** Output stream. Defaults to `process.stderr`. */
  stream?: NodeJS.WriteStream;
  /**
   * Force color on/off. Default: derive from `stream.isTTY`. Tests pass
   * `false` for deterministic snapshots.
   */
  color?: boolean;
  /**
   * Force emoji/glyph icons on/off. Default: derive from `stream.isTTY`.
   * Non-TTY contexts get plain ASCII prefixes.
   */
  icons?: boolean;
  /**
   * Width used for the `━━━` separators. Defaults to 60 or `stream.columns`
   * if available, whichever is smaller.
   */
  width?: number;
}

export interface TaskHandle {
  /** Mark the task done. `detail` is rendered as a dim trailing annotation. */
  complete(detail?: { costUsd?: number; elapsedMs?: number; note?: string }): void;
  /** Mark the task failed with a one-line reason. */
  fail(reason: string): void;
}

export interface ProgressReporter {
  /** Print a top-level phase header (icon + bold title + blank line). */
  phase(title: string, icon?: string): void;
  /** Short status note below the current phase. */
  step(message: string): void;
  /** Begin a numbered task in an ordered list; returns a handle to finish it. */
  taskStart(n: number, total: number, title: string): TaskHandle;
  /** Draw a horizontal separator, optionally labelled. */
  separator(title?: string): void;
  /** Render a bordered block — used for spec.md / roadmap.md previews. */
  preview(content: string, title?: string): void;
  /** Print a neutral info line (aligned with `step` but without indent). */
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  /** Emit a blank line. */
  blank(): void;
  /** Access to the underlying width (useful for preview-like custom blocks). */
  readonly width: number;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export function createProgressReporter(
  opts: ProgressReporterOptions = {},
): ProgressReporter {
  const stream = opts.stream ?? process.stderr;
  const isTTY = Boolean(stream.isTTY);
  const useColor = opts.color ?? isTTY;
  const useIcons = opts.icons ?? isTTY;
  const widthCap =
    opts.width ?? Math.min(60, Math.max(40, (stream.columns as number | undefined) ?? 60));

  const write = (s: string): void => {
    stream.write(s + '\n');
  };
  const paint = (s: string, fn: (x: string) => string): string =>
    useColor ? fn(s) : s;

  const icon = (emoji: string, ascii: string): string =>
    useIcons ? emoji : ascii;

  const hr = (char: string): string => char.repeat(widthCap);

  return {
    width: widthCap,

    phase(title, iconOverride) {
      write('');
      const glyph = iconOverride ?? icon('📋', '::');
      write(paint(`${glyph} ${title}`, colors.bold));
    },

    step(message) {
      write(`  ${message}`);
    },

    taskStart(n, total, title) {
      const label = `[${n}/${total}]`;
      const runningIcon = icon('⠋', '·');
      const line = `${paint(label, colors.cyan)} ${title}`;
      write(line);
      write(paint(`       ${runningIcon} 進行中…`, colors.dim));
      const started = Date.now();

      return {
        complete(detail) {
          const okIcon = icon('✓', 'OK');
          const parts: string[] = [];
          const elapsedMs = detail?.elapsedMs ?? Date.now() - started;
          parts.push(formatDuration(elapsedMs));
          if (detail?.costUsd !== undefined) {
            parts.push(`$${detail.costUsd.toFixed(4)}`);
          }
          if (detail?.note) parts.push(detail.note);
          const trailer = parts.length > 0 ? ` (${parts.join(', ')})` : '';
          write(`       ${paint(okIcon, colors.green)} 完了${paint(trailer, colors.dim)}`);
        },
        fail(reason) {
          const failIcon = icon('✗', 'FAIL');
          write(`       ${paint(failIcon, colors.red)} ${paint(reason, colors.red)}`);
        },
      };
    },

    separator(title) {
      write('');
      const bar = hr(useIcons ? '━' : '-');
      if (title) {
        const label = useIcons ? `  ${icon('📝', '::')} ${title}` : `  ${title}`;
        write(paint(bar, colors.dim));
        write(paint(label, colors.bold));
        write(paint(bar, colors.dim));
      } else {
        write(paint(bar, colors.dim));
      }
    },

    preview(content, title) {
      this.separator(title);
      write(content.endsWith('\n') ? content.trimEnd() : content);
      write(paint(hr(useIcons ? '━' : '-'), colors.dim));
      write('');
    },

    info(message) {
      const i = icon('ℹ', 'i');
      write(`${paint(i, colors.blue)} ${message}`);
    },

    warn(message) {
      const w = icon('⚠', '!');
      write(paint(`${w} ${message}`, colors.yellow));
    },

    error(message) {
      const e = icon('✗', 'ERR');
      write(paint(`${e} ${message}`, colors.red));
    },

    blank() {
      write('');
    },
  };
}

// ---------------------------------------------------------------------------
// No-op reporter — for tests / non-interactive code paths that don't want
// human-facing output but want the same surface.
// ---------------------------------------------------------------------------

export const nullProgressReporter: ProgressReporter = {
  width: 60,
  phase: () => undefined,
  step: () => undefined,
  taskStart: () => ({ complete: () => undefined, fail: () => undefined }),
  separator: () => undefined,
  preview: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  blank: () => undefined,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(sec < 10 ? 1 : 0)}秒`;
  const min = Math.floor(sec / 60);
  const remSec = Math.round(sec - min * 60);
  return `${min}分${remSec}秒`;
}
