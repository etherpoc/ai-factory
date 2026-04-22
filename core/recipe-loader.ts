import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseDocument } from 'yaml';
import { z } from 'zod';
import type { Recipe } from './types.js';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const MetaSchema = z.object({
  type: z.string().min(1),
  version: z.string().min(1),
  description: z.string().min(1),
});

const StackSchema = z.object({
  language: z.string().min(1),
  framework: z.string().min(1),
  deps: z.array(z.string()).default([]),
});

const ScaffoldSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('template'), path: z.string().min(1) }),
  z.object({ type: z.literal('generator'), command: z.string().min(1) }),
]);

const CommandSchema = z.object({
  command: z.string().min(1),
  timeoutSec: z.number().int().positive(),
  env: z.record(z.string(), z.string()).optional(),
});

const CriterionSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  required: z.boolean(),
});

const AgentOverrideSchema = z.object({
  promptAppend: z.string(),
  additionalTools: z.array(z.string()).optional(),
  model: z.string().optional(),
});

const AgentOverridesSchema = z
  .object({
    director: AgentOverrideSchema.optional(),
    architect: AgentOverrideSchema.optional(),
    programmer: AgentOverrideSchema.optional(),
    tester: AgentOverrideSchema.optional(),
    reviewer: AgentOverrideSchema.optional(),
    evaluator: AgentOverrideSchema.optional(),
    // Phase 11.a: per-role overrides for creative agents. Same shape as the
    // original 6 roles.
    artist: AgentOverrideSchema.optional(),
    sound: AgentOverrideSchema.optional(),
    writer: AgentOverrideSchema.optional(),
    critic: AgentOverrideSchema.optional(),
  })
  .optional();

// ---------------------------------------------------------------------------
// Phase 11.a: R6 (agents.required / agents.optional) and R9 (assets.budget)
// ---------------------------------------------------------------------------

const ROLE_ENUM = z.enum([
  'director',
  'architect',
  'programmer',
  'tester',
  'reviewer',
  'evaluator',
  'artist',
  'sound',
  'writer',
  'critic',
]);

const AgentsSpecSchema = z
  .object({
    /** Roles the orchestrator MUST run. Unspecified → the legacy 6 roles. */
    required: z.array(ROLE_ENUM).default([]),
    /**
     * Roles that are **enabled by default** when declared here. CLI flags
     * (`--no-assets`, `--skip-critic`) and `assetBudgetUsd === 0` opt out.
     */
    optional: z.array(ROLE_ENUM).default([]),
  })
  .optional();

const AssetBudgetSchema = z
  .object({
    maxUsd: z.number().nonnegative().optional(),
    maxCount: z.number().int().nonnegative().optional(),
  })
  .optional();

const AssetsImageSchema = z
  .object({
    defaultStyle: z
      .enum(['pixel-art', 'illustration', 'photo', 'icon', 'ui'])
      .optional(),
    defaultProvider: z.string().min(1).optional(),
    budget: AssetBudgetSchema,
  })
  .optional();

const AssetsAudioSchema = z
  .object({
    defaultProvider: z.string().min(1).optional(),
    budget: AssetBudgetSchema,
  })
  .optional();

const AssetsSpecSchema = z
  .object({
    image: AssetsImageSchema,
    audio: AssetsAudioSchema,
  })
  .optional();

export const RecipeSchema = z.object({
  meta: MetaSchema,
  stack: StackSchema,
  scaffold: ScaffoldSchema,
  agentOverrides: AgentOverridesSchema,
  build: CommandSchema,
  test: CommandSchema,
  evaluation: z.object({
    criteria: z.array(CriterionSchema).default([]),
    entrypoints: z.array(z.string()).optional(),
  }),
  // Phase 11.a extensions — both optional for backward compatibility with
  // pre-Phase-11.a recipe.yaml files.
  agents: AgentsSpecSchema,
  assets: AssetsSpecSchema,
});

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export interface LoadRecipeOptions {
  /** Directory that contains the `recipes/` tree. Defaults to `<cwd>`. */
  repoRoot?: string;
}

export class RecipeLoadError extends Error {
  constructor(
    message: string,
    public readonly file: string,
    public readonly details: string[] = [],
  ) {
    super(message);
    this.name = 'RecipeLoadError';
  }
}

export async function loadRecipe(type: string, opts: LoadRecipeOptions = {}): Promise<Recipe> {
  const root = resolve(opts.repoRoot ?? process.cwd());
  const file = join(root, 'recipes', type, 'recipe.yaml');
  const source = await readFile(file, 'utf8').catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') {
      throw new RecipeLoadError(`recipe not found: ${file}`, file);
    }
    throw err;
  });

  const doc = parseDocument(source, { prettyErrors: true });
  if (doc.errors.length > 0) {
    throw new RecipeLoadError(
      `YAML parse error in ${file}`,
      file,
      doc.errors.map((e) => e.message),
    );
  }

  const parsed = doc.toJS({ mapAsMap: false }) as unknown;
  const result = RecipeSchema.safeParse(parsed);
  if (!result.success) {
    const details = result.error.issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`);
    throw new RecipeLoadError(`recipe schema validation failed for ${file}`, file, details);
  }

  if (result.data.meta.type !== type) {
    throw new RecipeLoadError(
      `recipe meta.type "${result.data.meta.type}" does not match directory "${type}"`,
      file,
    );
  }

  const recipe: Recipe = {
    ...result.data,
    agentOverrides: result.data.agentOverrides ?? {},
  };
  return recipe;
}
