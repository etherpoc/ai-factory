/**
 * Phase 11.a.2 regression: the 4 creative agents are wired correctly.
 *
 * Covers:
 *   - AgentRole union includes artist/sound/writer/critic
 *   - DEFAULT_MODELS_BY_ROLE covers every AgentRole (no missing entries)
 *   - DEFAULT_TOOLS_BY_ROLE lists the expected tool names
 *   - createAllAgents builds 10 agents (drift guard against adding a role
 *     without updating the barrel)
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAllAgents } from '../../agents/index.js';
import { DEFAULT_MODELS_BY_ROLE } from '../../core/strategies/claude.js';
import { DEFAULT_TOOLS_BY_ROLE } from '../../core/tools/index.js';
import { MetricsRecorder } from '../../core/metrics.js';
import { nullLogger } from '../../core/logger.js';
import type { AgentRole, Recipe } from '../../core/types.js';

const CREATIVE_ROLES: AgentRole[] = ['artist', 'sound', 'writer', 'critic'];

function makeRecipe(): Recipe {
  return {
    meta: { type: 'demo', version: '1.0.0', description: 'demo' },
    stack: { language: 'typescript', framework: 'none', deps: [] },
    scaffold: { type: 'template', path: '_template' },
    agentOverrides: {},
    build: { command: 'true', timeoutSec: 1 },
    test: { command: 'true', timeoutSec: 1 },
    evaluation: { criteria: [] },
  };
}

describe('Phase 11.a.2 — creative agents are registered', () => {
  it('every creative role has a default model', () => {
    for (const role of CREATIVE_ROLES) {
      expect(DEFAULT_MODELS_BY_ROLE[role]).toBeTruthy();
    }
  });

  it('creative models respect F18: no Opus in defaults', () => {
    for (const role of CREATIVE_ROLES) {
      expect(DEFAULT_MODELS_BY_ROLE[role]).not.toMatch(/^claude-opus/);
    }
  });

  // Phase 11.a.6: critic was promoted from Haiku to Sonnet because Haiku
  // didn't reliably follow the "write_file('critique.md', …)" instruction
  // — it emitted the review as chat text and the file never landed.
  // Sonnet follows tool-use directives more strictly.
  it('creative models match the spec (all four on Sonnet after 11.a.6)', () => {
    expect(DEFAULT_MODELS_BY_ROLE.artist).toBe('claude-sonnet-4-6');
    expect(DEFAULT_MODELS_BY_ROLE.sound).toBe('claude-sonnet-4-6');
    expect(DEFAULT_MODELS_BY_ROLE.writer).toBe('claude-sonnet-4-6');
    expect(DEFAULT_MODELS_BY_ROLE.critic).toBe('claude-sonnet-4-6');
  });

  it('each creative role has a non-empty default tool list', () => {
    for (const role of CREATIVE_ROLES) {
      expect(DEFAULT_TOOLS_BY_ROLE[role].length).toBeGreaterThan(0);
    }
  });

  it('artist defaults include generate_image; sound defaults include generate_audio', () => {
    expect(DEFAULT_TOOLS_BY_ROLE.artist).toContain('generate_image');
    expect(DEFAULT_TOOLS_BY_ROLE.sound).toContain('generate_audio');
  });

  it('writer defaults do NOT include generate_* (LLM-only agent)', () => {
    expect(DEFAULT_TOOLS_BY_ROLE.writer).not.toContain('generate_image');
    expect(DEFAULT_TOOLS_BY_ROLE.writer).not.toContain('generate_audio');
  });

  it('critic defaults include bash (for Playwright screenshot capture)', () => {
    expect(DEFAULT_TOOLS_BY_ROLE.critic).toContain('bash');
  });

  // Regression: Programmer must not be able to generate assets itself.
  // Asset generation is concentrated in artist/sound. Programmer's job is to
  // read the manifests (assets-manifest.json, audio-manifest.json) and wire
  // the pre-generated assets into the app. Keeping this separation is how
  // we avoid cost blowups from the programmer speculatively re-generating
  // images mid-implementation.
  it('programmer does NOT get generate_image or generate_audio', () => {
    expect(DEFAULT_TOOLS_BY_ROLE.programmer).not.toContain('generate_image');
    expect(DEFAULT_TOOLS_BY_ROLE.programmer).not.toContain('generate_audio');
  });

  it('only artist/sound can call generate_* tools', () => {
    const rolesWithImage: string[] = [];
    const rolesWithAudio: string[] = [];
    for (const [role, tools] of Object.entries(DEFAULT_TOOLS_BY_ROLE)) {
      if (tools.includes('generate_image')) rolesWithImage.push(role);
      if (tools.includes('generate_audio')) rolesWithAudio.push(role);
    }
    expect(rolesWithImage).toEqual(['artist']);
    expect(rolesWithAudio).toEqual(['sound']);
  });
});

describe('createAllAgents builds the full role map', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'uaf-creative-'));
    // Phase 7.8: interviewer is now part of the role map (constructed but
    // unused by the orchestrator; spec-wizard invokes it directly).
    for (const role of [
      ...CREATIVE_ROLES,
      'director',
      'architect',
      'programmer',
      'tester',
      'reviewer',
      'evaluator',
      'interviewer',
      'roadmap-builder',
    ]) {
      await mkdir(join(root, 'agents', role), { recursive: true });
      await writeFile(join(root, 'agents', role, 'prompt.md'), `BASE_${role}`, 'utf8');
    }
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('returns one Agent per role (12 total: 6 base + 4 creative + interviewer + roadmap-builder)', async () => {
    const metrics = new MetricsRecorder({ projectId: 'p', dir: root, logger: nullLogger });
    const agents = await createAllAgents({ recipe: makeRecipe(), metrics, repoRoot: root });
    const keys = Object.keys(agents).sort();
    expect(keys.length).toBe(12);
    for (const role of CREATIVE_ROLES) {
      expect(agents[role]).toBeDefined();
      expect(agents[role].role).toBe(role);
      expect(agents[role].systemPrompt).toContain(`BASE_${role}`);
    }
    expect(agents.interviewer).toBeDefined();
    expect(agents.interviewer.role).toBe('interviewer');
    expect(agents['roadmap-builder']).toBeDefined();
    expect(agents['roadmap-builder']?.role).toBe('roadmap-builder');
  });
});
