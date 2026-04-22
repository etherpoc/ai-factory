# agents/ — 汎用エージェント群

## 概要

プロジェクト種別に依存しない役割ベースのエージェント。レシピ側の `agentOverrides.<role>.promptAppend` によって種別特化される。

## エージェント一覧

| ロール        | 責務                                            | 入力                       | 出力                       |
| ------------- | ----------------------------------------------- | -------------------------- | -------------------------- |
| `director/`   | PM。要件の PRD/GDD 化、スプリント計画           | ユーザリクエスト, 前回結果 | `workspace/<id>/spec.md`   |
| `architect/`  | 技術設計                                        | `spec.md`, recipe          | `workspace/<id>/design.md` |
| `programmer/` | 実装（ファイル書き込み, 依存追加）              | `design.md`, 失敗レポート  | 変更ファイル群             |
| `tester/`     | 自動テスト + Playwright E2E                     | 実装コード                 | テスト結果 JSON            |
| `reviewer/`   | コードレビュー（静的判定）                      | 変更 diff                  | 指摘リスト                 |
| `evaluator/`  | 完成度スコアリング (recipe.evaluation.criteria) | プロジェクト全体           | `CompletionScore`          |

## 各エージェントディレクトリの規約

```
agents/<role>/
├── README.md       # その役割の詳細
├── prompt.md       # ベース system prompt
└── index.ts        # createAgent() を export
```

- `prompt.md` は Markdown テキスト。`index.ts` から `readFile` で読み込み、`recipe.agentOverrides[<role>].promptAppend` を末尾に連結。
- ツール追加は `recipe.agentOverrides[<role>].additionalTools` で指定。

## 一括生成 API (`agents/index.ts`)

```ts
import { createAllAgents } from './agents';

const agents = await createAllAgents({
  recipe,
  metrics, // MetricsRecorder
  repoRoot, // 既定は process.cwd()
  strategy, // AgentStrategy — 既定は stubStrategy。本番は createClaudeStrategy()
});
```

個別ラッパ (`createDirectorAgent` など) も `agents/index.ts` から re-export されている。いずれも内部で `core/agent-factory.createAgent()` を呼び、`prompt.md` + `recipe.agentOverrides[role].promptAppend` を合成する。

## 拡張方法

新しいロールを追加する場合:

1. `agents/<new-role>/{README.md, prompt.md, index.ts}` を作成
2. `core/types.ts` の `AgentRole` に列挙子を追加
3. `agents/index.ts` の `ROLES` 配列に追加（orchestrator は自動的に呼び出す）
4. `core/strategies/claude.ts` の `roleFromAgentInput` / `parseResponse` に分岐を追加

## 変更履歴

- 2026-04-21 (Phase 0): 初版スタブ
- 2026-04-21 (Phase 2): 6 ロールすべての `prompt.md` (日本語・出力形式厳守) と `index.ts` ラッパを実装。`agents/index.ts` バレルに `createAllAgents()` を追加。
