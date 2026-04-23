#!/usr/bin/env tsx
/**
 * Phase 7.8.5 — interviewer 単体の実 LLM 試走スクリプト。
 *
 * 目的: Phase 7.8.7 の E2E より早く対話 UX を検証する。一つのレシピ種別に
 * 対して spec-wizard を回し、生成された spec.md を出力する。**ビルドフェーズ
 * には進まない**。
 *
 * 使い方:
 *   pnpm tsx scripts/trial-interviewer.ts <recipe> "<request>" [--auto]
 *
 *   --auto: 質問への回答を事前定義したシード（テスト/CI 用、対話なし）。
 *           省略時は普通に inquirer で対話する。
 *
 * 出力:
 *   workspace/.trial-interviewer/<timestamp>-<recipe>/spec.md
 *   metrics.jsonl から推定コストを表示
 */
import 'dotenv/config';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from '../core/logger.js';
import { loadRecipe } from '../core/recipe-loader.js';
import { MetricsRecorder } from '../core/metrics.js';
import { computeCost } from '../core/pricing.js';
import { createClaudeStrategy } from '../core/strategies/claude.js';
import { runSpecWizard } from '../cli/interactive/spec-wizard.js';
import type { AskUserPrompter } from '../core/tools/ask-user.js';
import type { MetricRecord } from '../core/types.js';

interface ParsedArgs {
  recipe: string;
  request: string;
  auto: boolean;
}

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  const auto = args.includes('--auto');
  const positional = args.filter((a) => a !== '--auto');
  if (positional.length < 2) {
    process.stderr.write(
      'usage: pnpm tsx scripts/trial-interviewer.ts <recipe> "<request>" [--auto]\n',
    );
    process.exit(2);
  }
  return { recipe: positional[0]!, request: positional[1]!, auto };
}

/** Pre-seeded answers for --auto mode. Matches whatever options the interviewer asks. */
const AUTO_ANSWERS: Array<{ answer: string; selectedIndex: number }> = [
  { answer: 'option-1', selectedIndex: 0 },
  { answer: 'option-2', selectedIndex: 1 },
  { answer: 'option-1', selectedIndex: 0 },
  { answer: 'option-1', selectedIndex: 0 },
  { answer: 'option-1', selectedIndex: 0 },
  { answer: 'option-1', selectedIndex: 0 },
  { answer: 'option-1', selectedIndex: 0 },
];

function autoPrompter(): AskUserPrompter {
  let i = 0;
  return {
    async select(o) {
      const a = AUTO_ANSWERS[i] ?? { answer: o.options[0]!, selectedIndex: 0 };
      const real = { answer: o.options[a.selectedIndex] ?? o.options[0]!, selectedIndex: a.selectedIndex };
      process.stderr.write(`[auto] Q${i + 1}: ${o.question}\n  → ${real.answer}\n`);
      i += 1;
      return real;
    },
    async input(o) {
      process.stderr.write(`[auto] Q${i + 1}: ${o.question}\n  → (default)\n`);
      i += 1;
      return 'default';
    },
  };
}

async function main(): Promise<void> {
  const { recipe: recipeType, request, auto } = parseArgs();
  if (!process.env.ANTHROPIC_API_KEY) {
    process.stderr.write('ANTHROPIC_API_KEY is not set.\n');
    process.exit(6);
  }

  const repoRoot = process.cwd();
  const ts = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
  const projectId = `trial-${ts}-${recipeType}`;
  const workspaceDir = join(repoRoot, 'workspace', '.trial-interviewer', projectId);
  await rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
  await mkdir(workspaceDir, { recursive: true });

  const logger = createLogger({ name: 'uaf.trial' });
  const recipe = await loadRecipe(recipeType, { repoRoot });
  const metrics = new MetricsRecorder({ projectId, dir: workspaceDir, logger });

  process.stderr.write(`\n=== interviewer trial: ${recipeType} ===\n`);
  process.stderr.write(`request: ${request}\n`);
  process.stderr.write(`workspace: ${workspaceDir}\n\n`);

  const strategy = createClaudeStrategy({ logger });

  const start = Date.now();
  const result = await runSpecWizard({
    request,
    workspaceDir,
    projectId,
    recipe,
    strategy,
    metrics,
    repoRoot,
    ...(auto ? { askUserPrompter: autoPrompter(), autoApprove: true } : { autoApprove: true }),
    logger,
  });
  const elapsedSec = ((Date.now() - start) / 1000).toFixed(1);

  // Read the generated spec and compute cost.
  const spec = await readFile(result.specPath, 'utf8');
  const metricsRaw = await readFile(join(workspaceDir, 'metrics.jsonl'), 'utf8').catch(() => '');
  let totalCost = 0;
  let llmCalls = 0;
  for (const line of metricsRaw.split('\n').filter(Boolean)) {
    try {
      const r = JSON.parse(line) as MetricRecord;
      totalCost += computeCost(r.model, {
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        cacheReadTokens: r.cacheReadTokens,
        cacheCreationTokens: r.cacheCreationTokens,
      });
      llmCalls += 1;
    } catch {
      /* skip */
    }
  }

  process.stdout.write('\n========== generated spec.md ==========\n');
  process.stdout.write(spec);
  process.stdout.write('\n========== end of spec.md ==========\n\n');
  process.stderr.write(
    `dialogTurns: ${result.dialogTurns}\n` +
      `LLM calls: ${llmCalls}\n` +
      `cost: $${totalCost.toFixed(4)}\n` +
      `elapsed: ${elapsedSec}s\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`trial-interviewer failed: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
