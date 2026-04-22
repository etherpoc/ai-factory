/**
 * `uaf add-recipe` — generate a new recipe type via the recipe-builder meta
 * agent. Phase 7.3 implementation. Ported from `scripts/add-recipe.ts`.
 *
 * Error surface:
 *   - missing args → wizard (Phase 7.4, stub today)
 *   - missing API key → API_KEY_MISSING (exit 6)
 *   - recipe-builder failure → RECIPE_BUILD_FAILED (exit 5)
 */
import { createLogger } from '../../core/logger.js';
import { computeCost } from '../../core/pricing.js';
import { UafError } from '../ui/errors.js';

export interface AddRecipeOptions {
  /** Recipe type slug (kebab-case). */
  type?: string;
  /** Natural-language description of the stack. */
  description?: string;
  /** Structurally similar existing recipe to use as reference. */
  reference?: string;
  /** Budget cap (USD). Informational only — the builder does not preempt. */
  budgetUsd?: string;
  /** Tool-use round cap. */
  maxRounds?: string;
  /** Builder model override. */
  model?: string;
}

export interface AddRecipeGlobalOpts {
  verbose?: boolean;
}

export async function runAddRecipe(
  opts: AddRecipeOptions,
  _global: AddRecipeGlobalOpts = {},
): Promise<void> {
  // ---- 1. Defensive precondition. The commander action handler routes
  //         missing type/description to the wizard — if we land here it's a
  //         programmatic bug worth surfacing.
  if (!opts.type || !opts.description) {
    throw new UafError('missing --type or --description', {
      code: 'ARG_MISSING',
      hint: 'Use `uaf add-recipe --type X --description "..."` or run the wizard.',
    });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new UafError('ANTHROPIC_API_KEY is not set', {
      code: 'API_KEY_MISSING',
      hint: 'Copy .env.example to .env and set your Anthropic API key.',
    });
  }

  const budgetUsd = Math.max(0.01, opts.budgetUsd ? Number.parseFloat(opts.budgetUsd) : 0.5);
  const logger = createLogger({ name: 'uaf.add-recipe' });
  logger.info('starting recipe-builder', {
    type: opts.type,
    description: opts.description,
    reference: opts.reference ?? '(none)',
    budgetUsd,
    model: opts.model ?? '(default Sonnet 4.6)',
  });

  const { buildRecipe, RecipeBuildError } = await import('../../meta/recipe-builder.js');

  const start = Date.now();
  let toolCallCount = 0;
  const byTool = new Map<string, { calls: number; fails: number }>();

  try {
    const result = await buildRecipe({
      type: opts.type,
      description: opts.description,
      repoRoot: process.cwd(),
      logger,
      ...(opts.model !== undefined ? { model: opts.model } : {}),
      ...(opts.maxRounds !== undefined
        ? { maxToolRounds: Number.parseInt(opts.maxRounds, 10) }
        : {}),
      ...(opts.reference !== undefined ? { referenceType: opts.reference } : {}),
      onRawUsage: (ev) => {
        logger.info('raw.usage', {
          round: ev.round,
          stopReason: ev.stopReason,
          usage: ev.usage,
        });
      },
      onToolCall: (ev) => {
        toolCallCount += 1;
        const b = byTool.get(ev.tool) ?? { calls: 0, fails: 0 };
        b.calls += 1;
        if (!ev.ok) b.fails += 1;
        byTool.set(ev.tool, b);
        logger.info('tool.call', {
          tool: ev.tool,
          ok: ev.ok,
          durationMs: ev.durationMs,
          args: ev.args,
        });
      },
    });

    const cost = computeCost(result.model, result.usage);
    const elapsedSec = Math.round((Date.now() - start) / 1000);
    const breakdown = [...byTool.entries()]
      .map(([name, v]) => `${name}=${v.calls}${v.fails ? `(${v.fails}✗)` : ''}`)
      .join(' ');

    process.stdout.write(
      `\n=== recipe-builder summary ===\n` +
        `type         : ${result.type}\n` +
        `path         : ${result.recipePath}\n` +
        `model        : ${result.model}\n` +
        `elapsed      : ${elapsedSec}s\n` +
        `tool calls   : ${toolCallCount}${breakdown ? ` (${breakdown})` : ''}\n` +
        `tokens       : in=${result.usage.inputTokens} out=${result.usage.outputTokens} ` +
        `cacheR=${result.usage.cacheReadTokens} cacheW=${result.usage.cacheCreationTokens}\n` +
        `cost         : $${cost.toFixed(4)} (budget $${budgetUsd.toFixed(2)}${
          cost > budgetUsd ? ' — EXCEEDED' : ''
        })\n` +
        `final text   : ${result.finalText.slice(0, 300)}\n`,
    );
  } catch (err) {
    if (err instanceof RecipeBuildError) {
      throw new UafError(`recipe-builder failed: ${err.message}`, {
        code: 'RECIPE_BUILD_FAILED',
        cause: err,
        details: {
          type: opts.type,
          tmpPath: err.tmpPath,
          reasons: err.details,
        },
        hint: 'Rerun with --reference <existing-type> to give the builder a structural template.',
      });
    }
    throw err;
  }
}
