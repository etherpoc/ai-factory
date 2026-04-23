/**
 * Roadmap evidence-based reconciliation (Phase 7.8.12).
 *
 * The orchestrator runs on phase-boundaries (director / architect / scaffold
 * / creative / sprint-stage) — it does NOT execute roadmap tasks one-by-one.
 * To keep the user-facing roadmap view honest, we infer task-completion state
 * from on-disk evidence at a handful of points:
 *
 *   - after `scaffold` succeeds → tasks in the "Setup" group become complete
 *     (package.json, configs, tsconfig exist)
 *   - after `orchestrator` returns with `done=true` → all remaining tasks
 *     become complete (caller handles this; not our job)
 *
 * When evidence doesn't line up (e.g. recipe has no Setup-phase tasks in the
 * roadmap), we return a warning in `warnings` instead of throwing — progress
 * is a UX concern, not a correctness contract. The `completedTaskIds` list is
 * what the caller should feed into `writeTaskCheckpoint`.
 */
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import type { RoadmapTask } from './state.js';

const SETUP_PHASE_NAMES: ReadonlySet<string> = new Set([
  'setup',
  'scaffold',
  'init',
  'initialization',
  'bootstrap',
]);

export interface ReconcileResult {
  completedTaskIds: string[];
  warnings: string[];
}

/**
 * After scaffold: mark all "Setup"-group tasks complete if the workspace
 * now has a package.json (or the recipe's scaffold marker).
 *
 * Matches groups by a case-insensitive set of common phase names; if a
 * roadmap uses a custom phase label that doesn't match, nothing is marked
 * (we warn, the CLI shows it dim).
 */
export async function reconcileAfterScaffold(input: {
  workspaceDir: string;
  tasks: readonly RoadmapTask[];
}): Promise<ReconcileResult> {
  const { workspaceDir, tasks } = input;
  const warnings: string[] = [];

  const hasPkgJson = await fileExists(join(workspaceDir, 'package.json'));
  if (!hasPkgJson) {
    warnings.push('scaffold 完了したが package.json が見当たらない — Setup タスクを自動完了しません');
    return { completedTaskIds: [], warnings };
  }

  const candidates = tasks.filter((t) => {
    if (t.status === 'completed' || t.status === 'skipped') return false;
    const phase = (t.phase ?? '').toLowerCase().trim();
    return SETUP_PHASE_NAMES.has(phase);
  });

  if (candidates.length === 0) {
    warnings.push(
      'roadmap に "Setup" フェーズのタスクが見つかりません — scaffold 後の自動完了マークをスキップ',
    );
  }

  return {
    completedTaskIds: candidates.map((t) => t.id),
    warnings,
  };
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}
