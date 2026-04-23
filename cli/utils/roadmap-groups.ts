/**
 * Group roadmap tasks by `phase` for the bird-eye view on the CLI.
 *
 * Order is preserved by first occurrence — the roadmap file itself lays
 * out groups in the order we want to render them. Tasks with an empty or
 * undefined `phase` fall into a single "その他" bucket at the end.
 * Phase 7.8.12.
 */
import type { RoadmapTask } from '../../core/state.js';

export interface RoadmapGroup {
  phase: string;
  taskIds: string[];
}

export function roadmapGroupsFromTasks(tasks: readonly RoadmapTask[]): RoadmapGroup[] {
  const byPhase = new Map<string, string[]>();
  const order: string[] = [];
  for (const t of tasks) {
    const key = (t.phase ?? '').trim() || 'その他';
    if (!byPhase.has(key)) {
      byPhase.set(key, []);
      order.push(key);
    }
    byPhase.get(key)!.push(t.id);
  }
  return order.map((phase) => ({ phase, taskIds: byPhase.get(phase)! }));
}
