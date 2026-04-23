#!/usr/bin/env tsx
/** Quick visual demo of the ProgressReporter UX. */
import { createProgressReporter } from '../cli/ui/progress.js';

async function main(): Promise<void> {
  const r = createProgressReporter({ color: true, icons: true, width: 60 });
  r.phase('仕様を詰めていきます', '📋');
  r.step('対話中…');
  r.step('✓ 仕様書を作成しました (spec.md)');
  r.separator('仕様書プレビュー');
  process.stderr.write('# 仕様書: 簡単なテスト\n## コンセプト\n2D 避けゲー…\n');
  r.separator();
  r.phase('ロードマップを作成中', '📋');
  r.step('✓ 11 タスクに分解しました (roadmap.md)');
  r.phase('実装を開始します', '🔨');
  const t1 = r.taskStart(1, 3, 'プロジェクト構造セットアップ');
  await new Promise((s) => setTimeout(s, 100));
  t1.complete({ elapsedMs: 12_400, costUsd: 0.031 });
  const t2 = r.taskStart(2, 3, 'アセット生成 (artist + sound)');
  await new Promise((s) => setTimeout(s, 50));
  t2.complete({ elapsedMs: 4_800, costUsd: 0.18, note: 'artist 7 imgs, sound 2 sfx' });
  const t3 = r.taskStart(3, 3, 'Phaser エンジン初期化');
  await new Promise((s) => setTimeout(s, 30));
  t3.fail('circuit breaker tripped');
}
main();
