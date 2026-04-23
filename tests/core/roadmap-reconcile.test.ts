/**
 * Phase 7.8.12 — roadmap evidence-based reconciliation tests.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { reconcileAfterScaffold } from '../../core/roadmap-reconcile';
import type { RoadmapTask } from '../../core/state';

async function makeDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'uaf-reconcile-'));
}

const setupTask = (id: string, phase: string): RoadmapTask => ({
  id,
  title: id,
  status: 'pending',
  phase,
});

describe('reconcileAfterScaffold', () => {
  it('marks all pending Setup-phase tasks complete when package.json exists', async () => {
    const dir = await makeDir();
    await writeFile(join(dir, 'package.json'), '{}', 'utf8');
    try {
      const result = await reconcileAfterScaffold({
        workspaceDir: dir,
        tasks: [
          setupTask('task-001', 'Setup'),
          setupTask('task-002', 'Setup'),
          setupTask('task-003', 'Core'),
        ],
      });
      expect(result.completedTaskIds).toEqual(['task-001', 'task-002']);
      expect(result.warnings).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('accepts alternate phase names (case-insensitive: scaffold / init / bootstrap)', async () => {
    const dir = await makeDir();
    await writeFile(join(dir, 'package.json'), '{}', 'utf8');
    try {
      const result = await reconcileAfterScaffold({
        workspaceDir: dir,
        tasks: [
          setupTask('a', 'SCAFFOLD'),
          setupTask('b', 'init'),
          setupTask('c', 'Bootstrap'),
          setupTask('d', 'Feature'),
        ],
      });
      expect(result.completedTaskIds).toEqual(['a', 'b', 'c']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('skips tasks that are already completed or skipped', async () => {
    const dir = await makeDir();
    await writeFile(join(dir, 'package.json'), '{}', 'utf8');
    try {
      const result = await reconcileAfterScaffold({
        workspaceDir: dir,
        tasks: [
          { id: 'a', title: 'a', status: 'completed', phase: 'Setup' },
          { id: 'b', title: 'b', status: 'skipped', phase: 'Setup' },
          { id: 'c', title: 'c', status: 'pending', phase: 'Setup' },
        ],
      });
      expect(result.completedTaskIds).toEqual(['c']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('warns without marking anything when package.json is missing', async () => {
    const dir = await makeDir();
    try {
      const result = await reconcileAfterScaffold({
        workspaceDir: dir,
        tasks: [setupTask('a', 'Setup')],
      });
      expect(result.completedTaskIds).toEqual([]);
      expect(result.warnings[0]).toMatch(/package\.json/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('warns when no tasks match any known Setup phase name', async () => {
    const dir = await makeDir();
    await writeFile(join(dir, 'package.json'), '{}', 'utf8');
    try {
      const result = await reconcileAfterScaffold({
        workspaceDir: dir,
        tasks: [setupTask('a', 'Custom Phase'), setupTask('b', 'Logic')],
      });
      expect(result.completedTaskIds).toEqual([]);
      expect(result.warnings[0]).toMatch(/Setup/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('never throws — returns an empty result on unexpected errors', async () => {
    // Pass a non-existent directory on purpose; should still resolve.
    const result = await reconcileAfterScaffold({
      workspaceDir: join(tmpdir(), 'uaf-does-not-exist-' + Math.random()),
      tasks: [setupTask('a', 'Setup')],
    });
    expect(result.completedTaskIds).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
