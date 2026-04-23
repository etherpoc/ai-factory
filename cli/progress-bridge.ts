/**
 * Translates orchestrator ProgressEvent streams into ProgressReporter calls
 * and manages the 15-second heartbeat timer (Phase 7.8.12).
 *
 * The orchestrator is timer-agnostic — it only emits events at stage
 * boundaries. This bridge:
 *
 *   1. Maps phase/sprint-stage events to `[N/total] label` task lines.
 *   2. Runs a `setInterval(15_000)` timer while a stage is in flight,
 *      calling `handle.heartbeat()` with the current hint (default 'llm').
 *   3. Updates the current hint on `hint` events (build / test / image / audio).
 *   4. Prints roadmap-bird-view on `roadmap-overview`, reconciliation notes on
 *      `reconcile`, skipped phases on `phase-skipped`.
 *
 * The `total` in `[N/total]` is a projection computed up-front (director +
 * architect + scaffold + creative-agents + maxSprints * 6_stages_per_sprint).
 * Actual runs often terminate early (done=true before maxSprints); we
 * overshoot slightly rather than rewriting past lines.
 */
import type { HeartbeatHint as CoreHint, ProgressSink } from '../core/types.js';
import type {
  HeartbeatHint,
  ProgressReporter,
  RoadmapGroup,
  TaskHandle,
} from './ui/progress.js';

export interface ProgressBridgeOptions {
  /** Heartbeat tick in ms. Default 15_000. */
  heartbeatIntervalMs?: number;
  /**
   * Time provider used by the bridge. Tests inject a deterministic clock.
   * Default: `() => Date.now()`.
   */
  now?: () => number;
  /** Override setInterval/clearInterval for deterministic tests. */
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
  /**
   * Projected sprint count for [N/total] labels. Typically `maxIter` from
   * the CLI. Default: 3.
   */
  maxSprints?: number;
  /**
   * Pre-determine the projected total step count. Mostly for tests. When
   * omitted, the bridge starts with 0 and widens as needed.
   */
  projectedTotal?: number;
  /** Set to false to suppress the roadmap bird-view. Default: true. */
  showRoadmapOverview?: boolean;
}

export interface ProgressBridge {
  sink: ProgressSink;
  /** Call when the run ends (success or fail) to stop any lingering timers. */
  close(): void;
  /** Exposed for tests — current total step projection. */
  readonly projectedTotal: number;
}

export function createProgressBridge(
  reporter: ProgressReporter,
  options: ProgressBridgeOptions = {},
): ProgressBridge {
  const heartbeatMs = options.heartbeatIntervalMs ?? 15_000;
  const now = options.now ?? (() => Date.now());
  const setTimer =
    options.setInterval ??
    ((fn: () => void, ms: number) =>
      setInterval(fn, ms) as unknown as ReturnType<typeof setInterval>);
  const clearTimer =
    options.clearInterval ??
    ((h: unknown) => clearInterval(h as ReturnType<typeof setInterval>));
  const maxSprints = Math.max(1, options.maxSprints ?? 3);
  const stagesPerSprint = 6; // programmer/build/tester/critic/reviewer/evaluator

  let stepCounter = 0;
  let projected = options.projectedTotal ?? 0;

  // Mutable per-stage state
  let handle: TaskHandle | null = null;
  let stageStartedAt = 0;
  let currentHint: HeartbeatHint = 'llm';
  let timer: unknown = null;

  const bumpProjected = (minExpected: number): void => {
    if (projected < minExpected) projected = minExpected;
  };
  const widenProjected = (incoming: number): void => {
    projected = Math.max(projected, incoming);
  };

  const stopTimer = (): void => {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  };
  const startTimer = (): void => {
    stopTimer();
    timer = setTimer(() => {
      if (!handle) return;
      handle.heartbeat({
        hint: currentHint,
        elapsedMs: now() - stageStartedAt,
      });
    }, heartbeatMs);
  };

  const openTask = (title: string): TaskHandle => {
    stepCounter += 1;
    bumpProjected(stepCounter);
    stageStartedAt = now();
    currentHint = 'llm';
    const h = reporter.taskStart(stepCounter, projected, title);
    handle = h;
    startTimer();
    return h;
  };

  const closeTask = (
    ok: boolean,
    detail?: { note?: string; durationMs?: number },
  ): void => {
    stopTimer();
    if (!handle) return;
    const elapsedMs = detail?.durationMs ?? now() - stageStartedAt;
    if (ok) {
      handle.complete({
        ...(detail?.note ? { note: detail.note } : {}),
        elapsedMs,
      });
    } else {
      handle.fail(detail?.note ?? '失敗');
    }
    handle = null;
  };

  const skipTask = (title: string, reason: string): void => {
    stepCounter += 1;
    bumpProjected(stepCounter);
    reporter.taskSkipped(stepCounter, projected, title, reason);
  };

  const sink: ProgressSink = {
    emit(ev) {
      switch (ev.kind) {
        case 'roadmap-overview': {
          if (options.showRoadmapOverview === false) return;
          const groups: RoadmapGroup[] = ev.groups.map((g) => ({
            phase: g.phase,
            taskIds: g.taskIds,
          }));
          reporter.roadmapOverview(groups, ev.totalTasks);
          // Baseline: we expect at minimum 3 pre-sprint phases + `maxSprints *
          // 6` stages. Anything smaller is fine — projected only widens.
          widenProjected(3 + maxSprints * stagesPerSprint);
          return;
        }
        case 'phase-skipped': {
          const label = labelForPhase(ev.phase);
          skipTask(label, ev.reason);
          return;
        }
        case 'phase-start': {
          const label = labelForPhase(ev.phase);
          openTask(label);
          return;
        }
        case 'phase-end': {
          closeTask(ev.ok, {
            ...(ev.note ? { note: ev.note } : {}),
            durationMs: ev.durationMs,
          });
          return;
        }
        case 'creative-agent-start': {
          // Creative agents are nested inside the "creative" phase; we treat
          // them as sub-steps using reporter.step so the outer phase-start
          // timer keeps ticking.
          reporter.step(`↳ ${ev.label}`);
          return;
        }
        case 'creative-agent-end': {
          if (!ev.ok && ev.errorMessage) {
            reporter.step(`   ${ev.role}: ${ev.errorMessage}`);
          }
          return;
        }
        case 'sprint-start': {
          widenProjected(stepCounter + stagesPerSprint);
          return;
        }
        case 'sprint-stage-start': {
          const sprintLabel = `Sprint ${ev.sprint}/${maxSprints}: ${ev.label}`;
          openTask(sprintLabel);
          // Build stage defaults to the "build" hint right away — avoids a
          // spurious "LLM 呼び出し中" flash in the first heartbeat.
          if (ev.stage === 'build') currentHint = 'build';
          return;
        }
        case 'sprint-stage-end': {
          closeTask(ev.ok, {
            ...(ev.note ? { note: ev.note } : {}),
            durationMs: ev.durationMs,
          });
          return;
        }
        case 'sprint-end':
          // No direct output — each stage already closed itself.
          return;
        case 'hint': {
          currentHint = toUiHint(ev.hint);
          return;
        }
        case 'reconcile': {
          reporter.reconcileNote(ev.completedTaskIds, ev.warnings);
          return;
        }
      }
    },
  };

  return {
    sink,
    close() {
      stopTimer();
      handle = null;
    },
    get projectedTotal() {
      return projected;
    },
  };
}

function labelForPhase(phase: string): string {
  switch (phase) {
    case 'director':
      return 'Director';
    case 'architect':
      return 'Architect';
    case 'scaffold':
      return 'Scaffold';
    case 'creative':
      return 'Creative';
    default:
      return phase.charAt(0).toUpperCase() + phase.slice(1);
  }
}

function toUiHint(h: CoreHint): HeartbeatHint {
  return h;
}
