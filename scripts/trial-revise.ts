#!/usr/bin/env tsx
/**
 * Phase 7.8.9 — live-LLM verification of the interviewer REVISE mode.
 *
 * Does NOT run the full spec-wizard (that would need a TTY for ask_user).
 * Instead:
 *   1. Write a hand-crafted v1 spec.md into a temp workspace
 *   2. Call `reviseSpecViaInterviewer` with a real Claude strategy
 *   3. Diff v1 vs v2 and report cost
 *
 * Usage:
 *   pnpm tsx scripts/trial-revise.ts
 *   pnpm tsx scripts/trial-revise.ts "自由指示文"
 */
import 'dotenv/config';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from '../core/logger.js';
import { loadRecipe } from '../core/recipe-loader.js';
import { MetricsRecorder } from '../core/metrics.js';
import { computeCost } from '../core/pricing.js';
import { createClaudeStrategy } from '../core/strategies/claude.js';
import { reviseSpecViaInterviewer } from '../agents/interviewer/index.js';
import { createAskUserTool } from '../core/tools/ask-user.js';
import { writeFileTool } from '../core/tools/index.js';
import type { MetricRecord, Tool } from '../core/types.js';

const V1_SPEC = `# 仕様書: シンプル避けゲー

## コンセプト

トップダウン視点の 2D 避けゲー。画面内に敵が湧き続ける中、プレイヤーは矢印キーで避けながら生存時間を稼ぐ。

## 機能要件 (MUST)

- プレイヤー操作: 矢印キーで 4 方向移動
- 敵: 画面外からランダムに 1 種類の直進弾が出現
- スコア: 生存秒数を表示
- 終了条件: 1 回被弾で即死

## 機能要件 (NICE TO HAVE)

- スコアランキング（ローカル保存）
- BGM / SE

## 非機能要件

- パフォーマンス: 60fps を維持
- アクセシビリティ: キーボードのみで完結

## UI / フロー

- タイトル画面 → ゲーム画面 → ゲームオーバー画面

## 技術ヒント (optional)

（特になし）

## 仕様確定の根拠 (Q&A 履歴)

- Q: 視点・ジャンル? A: トップダウン
- Q: 操作方法? A: キーボード矢印キー
- Q: 敵の種類? A: 1 種類の直進弾
- Q: 終了条件? A: 1 回被弾で即死
`;

const DEFAULT_INSTRUCTION =
  '難易度を 10 秒ごとに 20% アップするように変えて、敵も直進・追尾・弾幕の 3 種類に増やして。';

function parseArgs(): { instruction: string } {
  const args = process.argv.slice(2);
  return { instruction: args[0] ?? DEFAULT_INSTRUCTION };
}

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    process.stderr.write('ANTHROPIC_API_KEY is not set.\n');
    process.exit(6);
  }
  const { instruction } = parseArgs();

  const repoRoot = process.cwd();
  const ts = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
  const projectId = `trial-revise-${ts}`;
  const workspaceDir = join(repoRoot, 'workspace', '.trial-revise', projectId);
  await rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
  await mkdir(workspaceDir, { recursive: true });

  const specPath = join(workspaceDir, 'spec.md');
  await writeFile(specPath, V1_SPEC, 'utf8');

  const logger = createLogger({ name: 'uaf.trial-revise' });
  const recipe = await loadRecipe('2d-game', { repoRoot });
  const metrics = new MetricsRecorder({ projectId, dir: workspaceDir, logger });

  // Register tools. ask_user uses a "refuse" prompter since we don't expect
  // clarifications for this instruction; if the agent does ask, it gets an
  // error and should fall back to its best interpretation.
  const askUserTool = createAskUserTool({
    prompter: {
      async select() {
        throw new Error(
          'trial-revise: ask_user invoked but no human operator — the agent should interpret and proceed.',
        );
      },
      async input() {
        throw new Error(
          'trial-revise: ask_user invoked but no human operator — the agent should interpret and proceed.',
        );
      },
    },
  });
  const toolRegistry: ReadonlyMap<string, Tool> = new Map([
    [askUserTool.name, askUserTool],
    [writeFileTool.name, writeFileTool],
  ]);

  const strategy = createClaudeStrategy({ logger });

  process.stderr.write(`\n=== revise trial ===\n`);
  process.stderr.write(`workspace: ${workspaceDir}\n`);
  process.stderr.write(`instruction: ${instruction}\n\n`);

  const start = Date.now();
  await reviseSpecViaInterviewer({
    recipe,
    metrics,
    repoRoot,
    strategy,
    toolRegistry,
    projectId,
    workspaceDir,
    currentSpec: V1_SPEC,
    revisionRequest: instruction,
  });
  const elapsedSec = ((Date.now() - start) / 1000).toFixed(1);

  const v2 = await readFile(specPath, 'utf8');

  // --- Regression check: sections NOT mentioned in the instruction should
  // be byte-identical. We use "## 非機能要件" and "## UI / フロー" as
  // canaries — both untouched by the difficulty/enemy change.
  const nonFuncV1 = sliceSection(V1_SPEC, '## 非機能要件', '## UI / フロー');
  const nonFuncV2 = sliceSection(v2, '## 非機能要件', '## UI / フロー');
  const uiV1 = sliceSection(V1_SPEC, '## UI / フロー', '## 技術ヒント');
  const uiV2 = sliceSection(v2, '## UI / フロー', '## 技術ヒント');

  // --- Cost
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

  process.stdout.write('\n========== v2 spec.md ==========\n');
  process.stdout.write(v2);
  process.stdout.write('\n========== end of v2 ==========\n\n');

  // Regression report
  const nonFuncUnchanged = nonFuncV1 === nonFuncV2;
  const uiUnchanged = uiV1 === uiV2;
  process.stderr.write(
    `--- regression ---\n` +
      `non-functional section unchanged: ${nonFuncUnchanged}\n` +
      `UI / flow section unchanged: ${uiUnchanged}\n`,
  );
  if (!nonFuncUnchanged) {
    process.stderr.write(`  v1 non-func:\n${nonFuncV1}\n  v2 non-func:\n${nonFuncV2}\n`);
  }
  if (!uiUnchanged) {
    process.stderr.write(`  v1 UI:\n${uiV1}\n  v2 UI:\n${uiV2}\n`);
  }

  // Positive check: instruction keywords should appear in v2
  const has20Pct = /20\s*[%％]/.test(v2);
  const has10Sec = /10\s*秒/.test(v2);
  const has3Enemies = /3\s*(種類|種|types)/.test(v2);
  process.stderr.write(
    `--- positive checks ---\n` +
      `"20%" present: ${has20Pct}\n` +
      `"10秒" present: ${has10Sec}\n` +
      `"3 種類" present: ${has3Enemies}\n`,
  );

  process.stderr.write(
    `\n--- cost ---\n` +
      `LLM calls: ${llmCalls}\n` +
      `cost: $${totalCost.toFixed(4)}\n` +
      `elapsed: ${elapsedSec}s\n`,
  );

  // Exit nonzero if regression detected so CI fails loudly
  if (!nonFuncUnchanged || !uiUnchanged) {
    process.exit(3);
  }
}

function sliceSection(md: string, startHeader: string, endHeader: string): string {
  const s = md.indexOf(startHeader);
  if (s === -1) return '';
  const e = md.indexOf(endHeader, s + startHeader.length);
  return e === -1 ? md.slice(s) : md.slice(s, e);
}

main().catch((err) => {
  process.stderr.write(`trial-revise failed: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
