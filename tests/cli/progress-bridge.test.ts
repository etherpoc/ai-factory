/**
 * Phase 7.8.12 — progress bridge unit tests.
 *
 * Asserts that orchestrator ProgressEvents translate to the expected
 * sequence of ProgressReporter calls, and that the 15-second heartbeat
 * timer fires only while a stage is active.
 */
import { describe, expect, it } from 'vitest';
import { createProgressBridge } from '../../cli/progress-bridge.js';
import type {
  HeartbeatHint,
  ProgressReporter,
  RoadmapGroup,
  TaskHandle,
} from '../../cli/ui/progress.js';

type Call =
  | { fn: 'taskStart'; n: number; total: number; title: string }
  | { fn: 'taskSkipped'; n: number; total: number; title: string; reason: string }
  | { fn: 'roadmapOverview'; groups: RoadmapGroup[]; totalTasks: number }
  | { fn: 'reconcileNote'; completed: string[]; warnings: string[] }
  | { fn: 'step'; message: string }
  | { fn: 'complete'; note?: string; elapsedMs?: number }
  | { fn: 'fail'; reason: string }
  | { fn: 'heartbeat'; hint?: HeartbeatHint; elapsedMs?: number };

function recordingReporter(): { reporter: ProgressReporter; calls: Call[] } {
  const calls: Call[] = [];
  let activeHandle: TaskHandle | null = null;
  const handleFor = (): TaskHandle => {
    activeHandle = {
      complete(detail) {
        calls.push({
          fn: 'complete',
          ...(detail?.note !== undefined ? { note: detail.note } : {}),
          ...(detail?.elapsedMs !== undefined ? { elapsedMs: detail.elapsedMs } : {}),
        });
      },
      fail(reason) {
        calls.push({ fn: 'fail', reason });
      },
      heartbeat(input) {
        calls.push({
          fn: 'heartbeat',
          ...(input?.hint !== undefined ? { hint: input.hint } : {}),
          ...(input?.elapsedMs !== undefined ? { elapsedMs: input.elapsedMs } : {}),
        });
      },
    };
    return activeHandle;
  };
  void activeHandle;
  const reporter: ProgressReporter = {
    width: 60,
    phase: () => undefined,
    step: (message) => calls.push({ fn: 'step', message }),
    taskStart: (n, total, title) => {
      calls.push({ fn: 'taskStart', n, total, title });
      return handleFor();
    },
    taskSkipped: (n, total, title, reason) =>
      calls.push({ fn: 'taskSkipped', n, total, title, reason }),
    roadmapOverview: (groups, totalTasks) =>
      calls.push({ fn: 'roadmapOverview', groups, totalTasks }),
    reconcileNote: (completed, warnings) =>
      calls.push({ fn: 'reconcileNote', completed, warnings }),
    separator: () => undefined,
    preview: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    blank: () => undefined,
  };
  return { reporter, calls };
}

function fakeTimers() {
  let nowMs = 0;
  const pending: Array<{ fn: () => void; intervalMs: number; nextAt: number }> = [];
  return {
    now: () => nowMs,
    advance(ms: number) {
      const target = nowMs + ms;
      while (true) {
        const next = pending
          .filter((p) => p.nextAt <= target)
          .sort((a, b) => a.nextAt - b.nextAt)[0];
        if (!next) break;
        nowMs = next.nextAt;
        next.fn();
        next.nextAt += next.intervalMs;
      }
      nowMs = target;
    },
    setInterval: (fn: () => void, ms: number) => {
      const entry = { fn, intervalMs: ms, nextAt: nowMs + ms };
      pending.push(entry);
      return entry as unknown;
    },
    clearInterval: (handle: unknown) => {
      const idx = pending.indexOf(handle as (typeof pending)[number]);
      if (idx >= 0) pending.splice(idx, 1);
    },
  };
}

describe('ProgressBridge', () => {
  it('roadmap-overview forwards groups + widens projected total', () => {
    const { reporter, calls } = recordingReporter();
    const timers = fakeTimers();
    const bridge = createProgressBridge(reporter, {
      now: timers.now,
      setInterval: timers.setInterval,
      clearInterval: timers.clearInterval,
      maxSprints: 3,
    });
    bridge.sink.emit({
      kind: 'roadmap-overview',
      groups: [{ phase: 'Setup', taskIds: ['task-001'] }],
      totalTasks: 1,
    });
    expect(calls[0]).toEqual({
      fn: 'roadmapOverview',
      groups: [{ phase: 'Setup', taskIds: ['task-001'] }],
      totalTasks: 1,
    });
    // Projection baseline: 3 pre-sprint + 3 sprints × 6 stages = 21
    expect(bridge.projectedTotal).toBe(3 + 3 * 6);
  });

  it('phase-skipped increments the step counter and calls taskSkipped', () => {
    const { reporter, calls } = recordingReporter();
    const timers = fakeTimers();
    const bridge = createProgressBridge(reporter, {
      now: timers.now,
      setInterval: timers.setInterval,
      clearInterval: timers.clearInterval,
      maxSprints: 2,
      projectedTotal: 15,
    });
    bridge.sink.emit({ kind: 'phase-skipped', phase: 'director', reason: 'spec.md 既存' });
    bridge.sink.emit({ kind: 'phase-skipped', phase: 'architect', reason: 'design.md 既存' });
    const skipped = calls.filter((c) => c.fn === 'taskSkipped');
    expect(skipped.length).toBe(2);
    expect(skipped[0]).toMatchObject({ n: 1, title: 'Director' });
    expect(skipped[1]).toMatchObject({ n: 2, title: 'Architect' });
  });

  it('phase-start/end opens and closes a task and stops the timer', () => {
    const { reporter, calls } = recordingReporter();
    const timers = fakeTimers();
    const bridge = createProgressBridge(reporter, {
      now: timers.now,
      setInterval: timers.setInterval,
      clearInterval: timers.clearInterval,
    });
    bridge.sink.emit({ kind: 'phase-start', phase: 'architect', label: 'Architect' });
    timers.advance(20_000);
    bridge.sink.emit({ kind: 'phase-end', phase: 'architect', ok: true, durationMs: 20_000 });
    // No heartbeats (closed before 15s? actually 20s > 15s so one heartbeat)
    const heartbeats = calls.filter((c) => c.fn === 'heartbeat');
    expect(heartbeats.length).toBe(1);
    // Task completes after close
    const completes = calls.filter((c) => c.fn === 'complete');
    expect(completes.length).toBe(1);
  });

  it('heartbeat fires every 15 seconds while a stage is in flight', () => {
    const { reporter, calls } = recordingReporter();
    const timers = fakeTimers();
    const bridge = createProgressBridge(reporter, {
      now: timers.now,
      setInterval: timers.setInterval,
      clearInterval: timers.clearInterval,
    });
    bridge.sink.emit({
      kind: 'sprint-stage-start',
      sprint: 1,
      stage: 'programmer',
      label: 'Programmer',
    });
    timers.advance(60_000);
    bridge.sink.emit({
      kind: 'sprint-stage-end',
      sprint: 1,
      stage: 'programmer',
      ok: true,
      durationMs: 60_000,
    });
    const heartbeats = calls.filter((c) => c.fn === 'heartbeat');
    // 60s / 15s = 4 heartbeats
    expect(heartbeats.length).toBe(4);
    // All default to 'llm' when no hint event was emitted
    expect(heartbeats.every((h) => h.fn === 'heartbeat' && h.hint === 'llm')).toBe(true);
  });

  it('hint events update the current heartbeat hint', () => {
    const { reporter, calls } = recordingReporter();
    const timers = fakeTimers();
    const bridge = createProgressBridge(reporter, {
      now: timers.now,
      setInterval: timers.setInterval,
      clearInterval: timers.clearInterval,
    });
    bridge.sink.emit({
      kind: 'sprint-stage-start',
      sprint: 1,
      stage: 'programmer',
      label: 'Programmer',
    });
    timers.advance(15_000); // heartbeat #1 (llm)
    bridge.sink.emit({ kind: 'hint', hint: 'image' });
    timers.advance(15_000); // heartbeat #2 (image)
    bridge.sink.emit({ kind: 'hint', hint: 'audio' });
    timers.advance(15_000); // heartbeat #3 (audio)
    bridge.sink.emit({
      kind: 'sprint-stage-end',
      sprint: 1,
      stage: 'programmer',
      ok: true,
      durationMs: 45_000,
    });
    const hints = calls.filter((c): c is Extract<typeof c, { fn: 'heartbeat' }> =>
      c.fn === 'heartbeat',
    );
    expect(hints.map((h) => h.hint)).toEqual(['llm', 'image', 'audio']);
  });

  it('build-stage auto-sets the hint to "build"', () => {
    const { reporter, calls } = recordingReporter();
    const timers = fakeTimers();
    const bridge = createProgressBridge(reporter, {
      now: timers.now,
      setInterval: timers.setInterval,
      clearInterval: timers.clearInterval,
    });
    bridge.sink.emit({ kind: 'sprint-stage-start', sprint: 1, stage: 'build', label: 'Build' });
    timers.advance(15_000);
    bridge.sink.emit({
      kind: 'sprint-stage-end',
      sprint: 1,
      stage: 'build',
      ok: true,
      durationMs: 15_000,
    });
    const hb = calls.find((c) => c.fn === 'heartbeat');
    expect(hb).toMatchObject({ hint: 'build' });
  });

  it('creative-agent events render as step notes, not new tasks', () => {
    const { reporter, calls } = recordingReporter();
    const timers = fakeTimers();
    const bridge = createProgressBridge(reporter, {
      now: timers.now,
      setInterval: timers.setInterval,
      clearInterval: timers.clearInterval,
    });
    bridge.sink.emit({ kind: 'phase-start', phase: 'creative', label: 'Creative' });
    bridge.sink.emit({ kind: 'creative-agent-start', role: 'writer', label: 'Writer' });
    bridge.sink.emit({
      kind: 'creative-agent-end',
      role: 'writer',
      ok: true,
      durationMs: 3_000,
    });
    bridge.sink.emit({ kind: 'phase-end', phase: 'creative', ok: true, durationMs: 3_000 });
    const steps = calls.filter((c) => c.fn === 'step');
    // One "↳ Writer" step, no failure line (ok=true)
    expect(steps.length).toBe(1);
    expect(steps[0]).toMatchObject({ message: '↳ Writer' });
    // Exactly one taskStart (the outer "Creative" phase)
    expect(calls.filter((c) => c.fn === 'taskStart').length).toBe(1);
  });

  it('reconcile events forward to reporter.reconcileNote', () => {
    const { reporter, calls } = recordingReporter();
    const timers = fakeTimers();
    const bridge = createProgressBridge(reporter, {
      now: timers.now,
      setInterval: timers.setInterval,
      clearInterval: timers.clearInterval,
    });
    bridge.sink.emit({
      kind: 'reconcile',
      completedTaskIds: ['task-001', 'task-002'],
      warnings: ['foo'],
    });
    expect(calls.find((c) => c.fn === 'reconcileNote')).toMatchObject({
      completed: ['task-001', 'task-002'],
      warnings: ['foo'],
    });
  });

  it('close() stops the heartbeat timer even if no stage-end is emitted', () => {
    const { reporter, calls } = recordingReporter();
    const timers = fakeTimers();
    const bridge = createProgressBridge(reporter, {
      now: timers.now,
      setInterval: timers.setInterval,
      clearInterval: timers.clearInterval,
    });
    bridge.sink.emit({ kind: 'phase-start', phase: 'architect', label: 'Architect' });
    timers.advance(15_000); // one heartbeat
    bridge.close();
    timers.advance(60_000); // should not fire more heartbeats
    const heartbeats = calls.filter((c) => c.fn === 'heartbeat');
    expect(heartbeats.length).toBe(1);
  });

  it('first progress signal appears instantly (synchronously) for resume', () => {
    const { reporter, calls } = recordingReporter();
    const timers = fakeTimers();
    const bridge = createProgressBridge(reporter, {
      now: timers.now,
      setInterval: timers.setInterval,
      clearInterval: timers.clearInterval,
    });
    // Simulate the "続行しますか? Yes → roadmap overview" sequence.
    bridge.sink.emit({
      kind: 'roadmap-overview',
      groups: [{ phase: 'Setup', taskIds: ['task-001'] }],
      totalTasks: 1,
    });
    bridge.sink.emit({ kind: 'phase-skipped', phase: 'director', reason: 'spec.md 既存' });
    // No timer advances — these should render synchronously.
    expect(calls[0]?.fn).toBe('roadmapOverview');
    expect(calls[1]?.fn).toBe('taskSkipped');
  });
});
