/**
 * Phase 7.2 regression — schema.
 *
 * Guards against silent drift between the config schema and the AgentRole
 * union in core/types.ts. If a new role is added to core, this test fires.
 */
import { describe, it, expect } from 'vitest';
import {
  AGENT_ROLES,
  KNOWN_CONFIG_KEYS,
  ModelsSchema,
  UafConfigSchema,
  isKnownConfigKey,
} from '../../cli/config/schema.js';
import { DEFAULT_MODELS_BY_ROLE } from '../../core/strategies/claude.js';

describe('cli/config/schema', () => {
  it('AGENT_ROLES mirrors core DEFAULT_MODELS_BY_ROLE keys', () => {
    const coreRoles = Object.keys(DEFAULT_MODELS_BY_ROLE).sort();
    const configRoles = [...AGENT_ROLES].sort();
    expect(configRoles).toEqual(coreRoles);
  });

  it('ModelsSchema rejects an unknown role (strict)', () => {
    const res = ModelsSchema.safeParse({ programmer: 'x', impostor: 'y' });
    expect(res.success).toBe(false);
  });

  it('ModelsSchema accepts a partial override', () => {
    const res = ModelsSchema.safeParse({ programmer: 'claude-opus-4-7' });
    expect(res.success).toBe(true);
  });

  it('UafConfigSchema accepts an empty object', () => {
    const res = UafConfigSchema.safeParse({});
    expect(res.success).toBe(true);
  });

  it('UafConfigSchema rejects non-positive budget', () => {
    expect(UafConfigSchema.safeParse({ budget_usd: 0 }).success).toBe(false);
    expect(UafConfigSchema.safeParse({ budget_usd: -1 }).success).toBe(false);
    expect(UafConfigSchema.safeParse({ budget_usd: 0.01 }).success).toBe(true);
  });

  it('UafConfigSchema rejects non-integer iteration caps', () => {
    expect(UafConfigSchema.safeParse({ max_iterations: 1.5 }).success).toBe(false);
    expect(UafConfigSchema.safeParse({ max_rounds: 0 }).success).toBe(false);
    expect(UafConfigSchema.safeParse({ max_iterations: 5, max_rounds: 30 }).success).toBe(true);
  });

  it('UafConfigSchema rejects unknown top-level keys', () => {
    const res = UafConfigSchema.safeParse({ unknown_key: 'x' });
    expect(res.success).toBe(false);
  });

  it('KNOWN_CONFIG_KEYS covers every agent role', () => {
    for (const role of AGENT_ROLES) {
      expect(KNOWN_CONFIG_KEYS).toContain(`models.${role}`);
    }
  });

  it('isKnownConfigKey guards correctly', () => {
    expect(isKnownConfigKey('budget_usd')).toBe(true);
    expect(isKnownConfigKey('models.programmer')).toBe(true);
    expect(isKnownConfigKey('nope')).toBe(false);
  });
});
