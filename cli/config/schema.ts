/**
 * uaf configuration schema (Phase 7.2).
 *
 * The same schema applies to the global file (`~/.uaf/config.yaml`) and the
 * project file (`./.uafrc`). Every field is **optional** — merging with the
 * built-in defaults (`cli/config/defaults.ts`) happens in the loader.
 *
 * Snake_case is idiomatic in YAML; we keep it on the TS side too so the file
 * and the type stay visually identical.
 */
import { z } from 'zod';

/**
 * AgentRole kept in sync with core/types.ts. We don't import from core here to
 * keep the config module self-contained — a test locks this against
 * `AgentRole`.
 *
 * Phase 11.a adds artist/sound/writer/critic.
 */
export const AGENT_ROLES = [
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
] as const;
export type ConfigAgentRole = (typeof AGENT_ROLES)[number];

/** Per-role model overrides. Missing keys fall through to core defaults. */
export const ModelsSchema = z
  .object({
    director: z.string().min(1).optional(),
    architect: z.string().min(1).optional(),
    programmer: z.string().min(1).optional(),
    tester: z.string().min(1).optional(),
    reviewer: z.string().min(1).optional(),
    evaluator: z.string().min(1).optional(),
    artist: z.string().min(1).optional(),
    sound: z.string().min(1).optional(),
    writer: z.string().min(1).optional(),
    critic: z.string().min(1).optional(),
  })
  .strict();

export const ClassifierSchema = z
  .object({
    /** Force this recipe type instead of running the classifier. */
    default_type: z.string().min(1).optional(),
  })
  .strict();

// Phase 11.a — asset provider settings. All optional; defaults come from the
// recipe and env vars.
export const AssetsSchema = z
  .object({
    budget_usd: z.number().nonnegative().optional(),
    image: z
      .object({
        provider: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    audio: z
      .object({
        provider: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    cache: z
      .object({
        enabled: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const UafConfigSchema = z
  .object({
    /** Default per-run budget cap (USD). */
    budget_usd: z.number().positive().optional(),
    /** Orchestrator loop cap. */
    max_iterations: z.number().int().positive().optional(),
    /** Tool-use round cap per agent. */
    max_rounds: z.number().int().positive().optional(),
    /**
     * Absolute or ~-expandable path for generated workspaces. If absent, we
     * use `./workspace` relative to the repo root (Phase 6 behavior).
     */
    workspace_location: z.string().min(1).optional(),
    /** Role → model id overrides. */
    models: ModelsSchema.optional(),
    /** Classifier tweaks. */
    classifier: ClassifierSchema.optional(),
    /**
     * Editor used by `uaf open` and `uaf config edit`. If absent, we fall
     * through to `$EDITOR`, then a platform default.
     */
    editor: z.string().min(1).optional(),
    /**
     * Wizard questions to skip. Known values: "budget", "recipe",
     * "max_iterations". Unknown entries are ignored by the wizard.
     */
    skip_prompts: z.array(z.string().min(1)).optional(),
    /** Phase 11.a external asset provider settings. */
    assets: AssetsSchema.optional(),
  })
  .strict();

export type UafConfig = z.infer<typeof UafConfigSchema>;
export type UafConfigModels = NonNullable<UafConfig['models']>;
export type UafConfigClassifier = NonNullable<UafConfig['classifier']>;

/**
 * Dotted keys that `uaf config get/set` accepts. Listed here so the config
 * command can validate the key before touching a file.
 */
export const KNOWN_CONFIG_KEYS = [
  'budget_usd',
  'max_iterations',
  'max_rounds',
  'workspace_location',
  'editor',
  'models.director',
  'models.architect',
  'models.programmer',
  'models.tester',
  'models.reviewer',
  'models.evaluator',
  'models.artist',
  'models.sound',
  'models.writer',
  'models.critic',
  'classifier.default_type',
  // Phase 11.a: asset provider settings.
  'assets.budget_usd',
  'assets.image.provider',
  'assets.audio.provider',
  'assets.cache.enabled',
] as const;
export type ConfigKey = (typeof KNOWN_CONFIG_KEYS)[number];

export function isKnownConfigKey(k: string): k is ConfigKey {
  return (KNOWN_CONFIG_KEYS as readonly string[]).includes(k);
}
