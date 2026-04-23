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

export type HeartbeatHint = 'llm' | 'build' | 'test' | 'image' | 'audio';

export interface TaskHandle {
  /** Mark the task done. `detail` is rendered as a dim trailing annotation. */
  complete(detail?: { costUsd?: number; elapsedMs?: number; note?: string }): void;
  /** Mark the task failed with a one-line reason. */
  fail(reason: string): void;
  /**
   * Append a "still running" line. Call this periodically (e.g. every 15 s)
   * while a long task is in flight so the user sees the process hasn't
   * wedged. Colors shift dim → yellow past 2 min of elapsed time.
   * Phase 7.8.12.
   */
  heartbeat(input?: { hint?: HeartbeatHint; elapsedMs?: number }): void;
}

export interface RoadmapGroup {
  phase: string;
  taskIds: string[];
}

export interface ProgressReporter {
  /** Print a top-level phase header (icon + bold title + blank line). */
  phase(title: string, icon?: string): void;
  /** Short status note below the current phase. */
  step(message: string): void;
  /** Begin a numbered task in an ordered list; returns a handle to finish it. */
  taskStart(n: number, total: number, title: string): TaskHandle;
  /**
   * Print a single-line "[n/total] title - スキップ (reason)" entry. Used for
   * phases that resume bypasses (director / architect / scaffold). Phase 7.8.12.
   */
  taskSkipped(n: number, total: number, title: string, reason: string): void;
  /**
   * Print a compact bird's-eye view of the roadmap grouped by phase. Example:
   *   ロードマップ (12 タスク):
   *     Setup  ▸ task-001 task-002
   *     Core   ▸ task-003 task-004 task-005
   * Phase 7.8.12.
   */
  roadmapOverview(groups: RoadmapGroup[], totalTasks: number): void;
  /**
   * Print a dim reconciliation line under the current task:
   *   ▸ roadmap 照合: task-001 ✓, task-002 ✓
   * Phase 7.8.12.
   */
  reconcileNote(completedTaskIds: string[], warnings: string[]): void;
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
      const label = formatLabel(n, total);
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
        heartbeat(input) {
          const elapsedMs = input?.elapsedMs ?? Date.now() - started;
          const elapsedSec = Math.round(elapsedMs / 1000);
          const hint = input?.hint ?? 'llm';
          const hintLabel = renderHint(hint);
          const body = `⠋ 進行中 (経過 ${formatElapsed(elapsedSec)}, ${hintLabel})`;
          // Over 2 minutes: shift dim → yellow so long waits stand out.
          const colorFn = elapsedMs >= 120_000 ? colors.yellow : colors.dim;
          write(`       ${paint(body, colorFn)}`);
        },
      };
    },

    taskSkipped(n, total, title, reason) {
      const label = formatLabel(n, total);
      const okIcon = icon('✓', 'OK');
      const line = `${paint(label, colors.cyan)} ${title}`;
      write(line);
      write(`       ${paint(okIcon, colors.dim)} ${paint(`スキップ (${reason})`, colors.dim)}`);
    },

    roadmapOverview(groups, totalTasks) {
      if (groups.length === 0 || totalTasks === 0) return;
      write('');
      write(paint(`ロードマップ (${totalTasks} タスク):`, colors.bold));
      const maxPhaseLen = Math.max(...groups.map((g) => g.phase.length));
      for (const g of groups) {
        const padded = g.phase.padEnd(maxPhaseLen, ' ');
        const ids = g.taskIds.join(' ');
        write(paint(`  ${padded} ${icon('▸', '>')} ${ids}`, colors.dim));
      }
      write('');
    },

    reconcileNote(completedTaskIds, warnings) {
      if (completedTaskIds.length === 0 && warnings.length === 0) return;
      const arrow = icon('▸', '>');
      if (completedTaskIds.length > 0) {
        const list = completedTaskIds.map((id) => `${id} ${icon('✓', 'v')}`).join(', ');
        write(paint(`       ${arrow} roadmap 照合: ${list}`, colors.dim));
      }
      for (const w of warnings) {
        write(paint(`       ${icon('⚠', '!')} ${w}`, colors.yellow));
      }
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
  taskStart: () => ({
    complete: () => undefined,
    fail: () => undefined,
    heartbeat: () => undefined,
  }),
  taskSkipped: () => undefined,
  roadmapOverview: () => undefined,
  reconcileNote: () => undefined,
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

function formatElapsed(sec: number): string {
  if (sec < 60) return `${sec}秒`;
  const min = Math.floor(sec / 60);
  const rem = sec - min * 60;
  return rem === 0 ? `${min}分` : `${min}分${rem}秒`;
}

function formatLabel(n: number, total: number): string {
  const width = Math.max(String(total).length, 2);
  return `[${String(n).padStart(width, ' ')}/${total}]`;
}

function renderHint(hint: HeartbeatHint): string {
  switch (hint) {
    case 'llm':
      return 'LLM 呼び出し中';
    case 'build':
      return 'ビルド中';
    case 'test':
      return 'テスト実行中';
    case 'image':
      return '画像生成中';
    case 'audio':
      return '音声生成中';
  }
}
