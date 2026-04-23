import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAllAgents } from '../../agents/index';
import type { Recipe } from '../../core/types';
import { nullLogger } from '../../core/logger';
import { MetricsRecorder } from '../../core/metrics';

function makeRecipe(): Recipe {
  return {
    meta: { type: 'demo', version: '1.0.0', description: 'demo' },
    stack: { language: 'typescript', framework: 'none', deps: [] },
    scaffold: { type: 'template', path: '_template' },
    agentOverrides: {
      director: { promptAppend: 'DIRECTOR_EXTRA' },
      programmer: { promptAppend: 'PROG_EXTRA' },
    },
    build: { command: 'true', timeoutSec: 1 },
    test: { command: 'true', timeoutSec: 1 },
    evaluation: { criteria: [] },
  };
}

describe('createAllAgents', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'uaf-barrel-'));
    for (const role of [
      'director',
      'architect',
      'programmer',
      'tester',
      'reviewer',
      'evaluator',
      // Phase 11.a additions
      'artist',
      'sound',
      'writer',
      'critic',
      // Phase 7.8 — pre-orchestrator dialogue + planning agents
      'interviewer',
      'roadmap-builder',
    ]) {
      await mkdir(join(root, 'agents', role), { recursive: true });
      await writeFile(
        join(root, 'agents', role, 'prompt.md'),
        `BASE_${role.toUpperCase()}`,
        'utf8',
      );
    }
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('produces one Agent per role with the correct name and merged prompt', async () => {
    const metrics = new MetricsRecorder({ projectId: 'p', dir: root, logger: nullLogger });
    const recipe = makeRecipe();
    const agents = await createAllAgents({ recipe, metrics, repoRoot: root });

    const roles = Object.keys(agents).sort();
    expect(roles).toEqual([
      'architect',
      'artist',
      'critic',
      'director',
      'evaluator',
      'interviewer',
      'programmer',
      'reviewer',
      'roadmap-builder',
      'sound',
      'tester',
      'writer',
    ]);
    expect(agents.director.name).toBe('director:demo');
    expect(agents.director.systemPrompt).toContain('BASE_DIRECTOR');
    expect(agents.director.systemPrompt).toContain('DIRECTOR_EXTRA');

    // Roles without an override should have no separator
    expect(agents.tester.systemPrompt).toBe('BASE_TESTER');
  });
});
