/**
 * SIGINT handler for Phase 7.8 (R12 常時再開可能原則).
 *
 * Behaviour:
 *   1st Ctrl+C → write an interrupt checkpoint to the active project's
 *                state.json, print a "resume with: uaf resume <id>" hint,
 *                set status='interrupted', exit 130.
 *   2nd Ctrl+C → bail out immediately (exit 130) — useful when checkpoint
 *                writing itself hangs.
 *
 * The orchestrator (or any long-running command) calls `setActiveProject(...)`
 * to register where to write the checkpoint, and `clearActiveProject()` when
 * it finishes normally.
 *
 * This module owns no other state — the SIGINT listener is installed exactly
 * once via `installSigintHandler()`. Subsequent calls are no-ops.
 */
import { writeInterruptCheckpoint } from './checkpoint.js';

interface ActiveProject {
  projectId: string;
  workspaceDir: string;
}

let active: ActiveProject | null = null;
let installed = false;
let firstSigintAt = 0;

export function setActiveProject(p: ActiveProject): void {
  active = p;
}

export function clearActiveProject(): void {
  active = null;
}

export function getActiveProject(): ActiveProject | null {
  return active;
}

export interface InstallSigintHandlerOptions {
  /** Override stdout for tests. Defaults to process.stderr. */
  out?: NodeJS.WriteStream;
  /** Override exit so tests don't kill the process. */
  exit?: (code: number) => void;
}

export function installSigintHandler(opts: InstallSigintHandlerOptions = {}): void {
  if (installed) return;
  installed = true;
  const out = opts.out ?? process.stderr;
  const exit = opts.exit ?? ((code: number) => process.exit(code));

  process.on('SIGINT', () => {
    const now = Date.now();
    if (firstSigintAt > 0 && now - firstSigintAt < 5_000) {
      // Second Ctrl+C within 5s — give up, exit immediately.
      out.write('\nReceived a second Ctrl+C — exiting immediately.\n');
      exit(130);
      return;
    }
    firstSigintAt = now;

    const cur = active;
    if (!cur) {
      // Nothing in flight — just exit.
      out.write('\nInterrupted.\n');
      exit(130);
      return;
    }

    out.write(`\nInterrupt received. Saving checkpoint for ${cur.projectId}…\n`);
    writeInterruptCheckpoint(cur.workspaceDir, 'SIGINT (Ctrl+C)')
      .then(() => {
        out.write(`Checkpoint saved. Resume with:\n  uaf resume ${cur.projectId}\n`);
        exit(130);
      })
      .catch((err: unknown) => {
        out.write(
          `Failed to save checkpoint: ${err instanceof Error ? err.message : String(err)}\n` +
            `Press Ctrl+C again to force exit.\n`,
        );
        // Don't exit — wait for the second SIGINT (which we time-boxed above).
      });
  });
}

/** For tests: reset the singleton so a fresh handler can be installed. */
export function __resetSigintHandlerForTests(): void {
  active = null;
  installed = false;
  firstSigintAt = 0;
}
