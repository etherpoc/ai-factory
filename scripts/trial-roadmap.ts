#!/usr/bin/env tsx
/**
 * Phase 7.8.13 — roadmap-builder 単体の実 LLM 試走スクリプト。
 *
 * 目的: Phase 11.a.6 Critic と同系統の問題（LLM が tool を呼ばずに応答だけで
 * 済ませる）が roadmap-builder で発生したため、プロンプト強化後に
 * `write_file('roadmap.md', ...)` が確実に呼ばれることを実 API で検証する。
 *
 * trial-interviewer.ts の姉妹: あちらは spec-wizard だけを回すのに対し、
 * こちらは事前に用意した spec.md を読ませて buildRoadmap() だけを叩く。
 * interviewer は回さない（そこはテスト対象ではない）。
 *
 * 使い方:
 *   pnpm tsx scripts/trial-roadmap.ts [recipe]
 *     recipe を省略すると 2d-game。
 *
 * 合格条件:
 *   - roadmap.md がファイルとして存在する（これが今回の本丸）
 *   - タスク 4 件以上
 *   - 推定コスト $0.10 未満で完了
 */
import 'dotenv/config';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from '../core/logger.js';
import { loadRecipe } from '../core/recipe-loader.js';
import { MetricsRecorder } from '../core/metrics.js';
import { computeCost } from '../core/pricing.js';
import { createClaudeStrategy } from '../core/strategies/claude.js';
import { buildRoadmap } from '../core/roadmap-builder.js';
import type { MetricRecord } from '../core/types.js';

const DEFAULT_RECIPE = '2d-game';

const SPEC_MD = `# 避けゲー

## 概要
プレイヤーが上から降ってくる障害物を左右移動で避けるシンプルな 2D ゲーム。

## ゲームプレイ
- プレイヤーは画面下部で左右に移動できる
- 障害物は画面上部からランダム位置で落下
- 当たったら Game Over、避け続けた秒数がスコア

## 画面構成
- Title: タイトル画面（Start ボタン）
- Game: メインゲーム
- GameOver: 最終スコア + Retry ボタン

## アセット
- プレイヤー画像 1 枚
- 障害物画像 1〜2 枚
- BGM 1 曲
- SFX（衝突音）1 個

## 技術制約
- Phaser 3 + TypeScript
- ブラウザ動作、60 FPS
- キーボード操作（← →）
`;

async function main(): Promise<void> {
  const recipeType = process.argv[2] ?? DEFAULT_RECIPE;
  if (!process.env.ANTHROPIC_API_KEY) {
    process.stderr.write('ANTHROPIC_API_KEY is not set.\n');
    process.exit(6);
  }

  const repoRoot = process.cwd();
  const ts = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
  const projectId = `trial-rb-${ts}-${recipeType}`;
  const workspaceDir = join(repoRoot, 'workspace', '.trial-roadmap', projectId);
  await rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
  await mkdir(workspaceDir, { recursive: true });

  const logger = createLogger({ name: 'uaf.trial-rb' });
  const recipe = await loadRecipe(recipeType, { repoRoot });
  const metrics = new MetricsRecorder({ projectId, dir: workspaceDir, logger });

  // Seed the workspace with a canned spec so the agent only has to do its
  // read→plan→write job. interviewer is explicitly out of scope.
  await writeFile(join(workspaceDir, 'spec.md'), SPEC_MD, 'utf8');

  process.stderr.write(`\n=== roadmap-builder trial: ${recipeType} ===\n`);
  process.stderr.write(`workspace: ${workspaceDir}\n\n`);

  const strategy = createClaudeStrategy({ logger });

  const start = Date.now();
  let result: Awaited<ReturnType<typeof buildRoadmap>> | undefined;
  let failure: unknown;
  try {
    result = await buildRoadmap({
      workspaceDir,
      projectId,
      request: SPEC_MD.split('\n')[0]!.replace(/^#\s*/, ''),
      recipe,
      strategy,
      metrics,
      repoRoot,
      logger,
    });
  } catch (err) {
    failure = err;
  }
  const elapsedSec = ((Date.now() - start) / 1000).toFixed(1);

  // Cost rollup.
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

  // Result summary.
  process.stderr.write(`\n--- result ---\n`);
  if (failure) {
    process.stderr.write(`✗ buildRoadmap threw: ${failure instanceof Error ? failure.message : String(failure)}\n`);
  } else if (result) {
    process.stderr.write(`✓ roadmap.md written at ${result.markdownPath}\n`);
    process.stderr.write(`✓ tasks: ${result.roadmap.totalTasks}\n`);
    const md = await readFile(result.markdownPath, 'utf8');
    process.stdout.write('\n========== roadmap.md ==========\n');
    process.stdout.write(md);
    process.stdout.write('\n========== end ==========\n\n');
  }
  process.stderr.write(
    `LLM calls: ${llmCalls}\n` +
      `cost: $${totalCost.toFixed(4)}\n` +
      `elapsed: ${elapsedSec}s\n`,
  );

  if (failure) process.exit(1);
}

main().catch((err) => {
  process.stderr.write(`trial-roadmap failed: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
