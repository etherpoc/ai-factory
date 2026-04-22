/**
 * Regression harness for FINDINGS.md F7:
 * The pristine scaffold of every recipe MUST NOT satisfy all required criteria.
 * This test copies the template into a temp workspace and runs the orchestrator's
 * `defaultEvaluate` with buildOk=true + testReport.failed=1 (simulating the
 * interaction/gameplay spec failing because programmer did not implement it).
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nullLogger } from '../../core/logger';
import { defaultEvaluate, defaultScaffold } from '../../core/orchestrator';
import { loadRecipe } from '../../core/recipe-loader';
import type { TestReport, WorkspaceHandle } from '../../core/types';

const REPO_ROOT = process.cwd();

describe('empty scaffold does not satisfy all criteria', () => {
  it.each(['2d-game', 'web-app'])('recipe %s: pristine template → done=false', async (type) => {
    const dir = await mkdtemp(join(tmpdir(), `uaf-empty-${type}-`));
    try {
      const recipe = await loadRecipe(type, { repoRoot: REPO_ROOT });
      const handle: WorkspaceHandle = {
        projectId: 'empty-scaffold',
        dir,
        branch: '(test)',
        cleanup: async () => undefined,
      };
      await defaultScaffold(recipe, handle, nullLogger, REPO_ROOT);

      // Simulate: build succeeded, but the strict test (gameplay / interaction)
      // failed because the template does not implement the contract.
      const testReport: TestReport = {
        passed: 1,
        failed: 1,
        durationMs: 100,
        failures: [
          {
            suite: 'e2e',
            name: type === '2d-game' ? 'gameplay' : 'interaction',
            message: 'template does not implement the contract',
          },
        ],
      };
      const score = await defaultEvaluate(recipe, {}, true, testReport, handle, REPO_ROOT);

      expect(score.done, `${type} template should NOT be marked done on empty scaffold`).toBe(
        false,
      );

      const byId = Object.fromEntries(score.perCriterion.map((c) => [c.id, c]));
      expect(byId['entrypoints-implemented']?.passed, 'entrypoint still byte-identical').toBe(
        false,
      );
      expect(byId['tests-pass']?.passed, 'tests-pass should fail when strict test fails').toBe(
        false,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
