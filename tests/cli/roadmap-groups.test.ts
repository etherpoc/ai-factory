/**
 * Phase 7.8.12 — roadmap-bird-eye grouping helper tests.
 */
import { describe, expect, it } from 'vitest';
import { roadmapGroupsFromTasks } from '../../cli/utils/roadmap-groups';
import type { RoadmapTask } from '../../core/state';

const t = (id: string, phase?: string): RoadmapTask => ({
  id,
  title: id,
  status: 'pending',
  ...(phase !== undefined ? { phase } : {}),
});

describe('roadmapGroupsFromTasks', () => {
  it('preserves first-occurrence group order', () => {
    const groups = roadmapGroupsFromTasks([
      t('task-001', 'Setup'),
      t('task-002', 'Setup'),
      t('task-003', 'Core'),
      t('task-004', 'Setup'),
      t('task-005', 'Polish'),
    ]);
    expect(groups.map((g) => g.phase)).toEqual(['Setup', 'Core', 'Polish']);
    expect(groups[0]!.taskIds).toEqual(['task-001', 'task-002', 'task-004']);
  });

  it('bunches tasks without a phase under "その他"', () => {
    const groups = roadmapGroupsFromTasks([t('a'), t('b', 'Core'), t('c', '')]);
    const other = groups.find((g) => g.phase === 'その他');
    expect(other?.taskIds).toEqual(['a', 'c']);
    expect(groups.find((g) => g.phase === 'Core')?.taskIds).toEqual(['b']);
  });

  it('handles empty task lists', () => {
    expect(roadmapGroupsFromTasks([])).toEqual([]);
  });
});
