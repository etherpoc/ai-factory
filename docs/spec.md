# Claude Code 実装指示書: Universal Agent Factory

## ミッション

ユーザーの自然言語リクエストから、ゲーム・Webアプリ・モバイルアプリ・デスクトップアプリ・CLI・APIを**完全自動**で生成するマルチエージェントシステム `universal-agent-factory` を実装せよ。

このシステム自体の設計・実装も、必要に応じてメタエージェント（自分自身を拡張するエージェント）が担う構造とする。

---

## コア原則（絶対厳守）

### R1. README ファースト原則

- プロジェクトルートの `README.md` が**システム仕様の正**である
- 機能追加・変更・削除を行う前に、必ず `README.md` を先に更新する（仕様駆動開発）
- 各サブディレクトリ（`core/`, `recipes/*/`, `agents/*/`）にも個別の `README.md` を配置し、そのディレクトリの責務・インターフェース・使い方を記述する
- エージェントが新しいレシピやエージェントを生成する際も、**必ず該当ディレクトリに README.md を自動生成**する
- README.md に含めるべき項目:
  1. 概要（What / Why）
  2. アーキテクチャ図（Mermaid推奨）
  3. セットアップ手順
  4. 使い方（コマンド例、入出力例）
  5. 拡張方法（新レシピ追加手順など）
  6. トラブルシューティング
  7. 変更履歴（日付 + 概要）

### R2. レシピ拡張原則

新しいプロジェクト種別は `recipes/<type>/` にレシピを追加するだけで対応できること。コア層は変更不要とする。

### R3. 決定論的検証原則

すべてのエージェント出力は、自動検証ツール（ビルド、Lint、テスト、E2E）で機械的に検証できる形式にする。LLMの判定だけで「完成」としない。

### R4. サーキットブレーカー原則

同じエラーが3回連続、またはイテレーションが規定上限に達した場合、人間に通知して停止する。無限ループ・暴走を防ぐ。

### R5. コスト可観測性原則

各エージェント呼び出しのトークン消費・所要時間・使用モデルを `workspace/<proj-id>/metrics.jsonl` に記録する。

---

## 技術スタック

- **言語**: TypeScript (Node.js 20+)
- **パッケージマネージャ**: pnpm
- **エージェント基盤**: Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`)
- **オーケストレーション**: 自前の軽量ループ（LangGraph等の重いフレームワークは避ける）
- **ブラウザ自動化**: Playwright
- **ワークスペース隔離**: git worktree（並列実行対応）
- **設定**: YAML（レシピ定義）、`.env`（APIキー）
- **ロギング**: pino（構造化ログ）
- **テスト**: Vitest

---

## アーキテクチャ

### ディレクトリ構造（初期実装必須）

```
universal-agent-factory/
├── README.md                      # 【R1】システム全体仕様
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.json
├── .env.example
├── core/
│   ├── README.md                  # コア層の説明
│   ├── orchestrator.ts            # メインループ
│   ├── classifier.ts              # リクエスト分類
│   ├── recipe-loader.ts           # レシピ読込
│   ├── agent-factory.ts           # エージェント生成
│   ├── workspace-manager.ts       # プロジェクト隔離
│   ├── circuit-breaker.ts         # 【R4】
│   ├── metrics.ts                 # 【R5】
│   └── types.ts                   # 共通型定義
├── agents/
│   ├── README.md                  # 汎用エージェント一覧
│   ├── director/                  # PM役
│   ├── architect/                 # 技術設計
│   ├── programmer/                # 実装
│   ├── reviewer/                  # コードレビュー
│   ├── tester/                    # 自動テスト
│   └── evaluator/                 # 完成度評価
│       └── （各ディレクトリに README.md, prompt.md, index.ts）
├── recipes/
│   ├── README.md                  # レシピ仕様 + 追加手順
│   ├── _template/                 # 【重要】新レシピ生成の雛形
│   ├── 2d-game/
│   ├── web-app/
│   └── （以下順次）
├── meta/
│   ├── README.md
│   └── recipe-builder.ts          # レシピを自動生成するメタエージェント
├── workspace/                     # 生成物（.gitignore）
├── tests/
│   ├── core/
│   └── recipes/
└── scripts/
    ├── create.ts                  # CLIエントリ: npx uaf create "..."
    └── add-recipe.ts              # CLIエントリ: npx uaf add-recipe <name>
```

### エージェント共通インターフェース

```typescript
interface Agent {
  name: string;
  role: string;
  systemPrompt: string; // base + recipeで合成
  tools: Tool[];
  invoke(input: AgentInput): Promise<AgentOutput>;
}

interface Recipe {
  meta: { type: string; version: string; description: string };
  stack: { language: string; framework: string; deps: string[] };
  scaffold: string; // 雛形パスまたはジェネレータ
  agentOverrides: Record<string, { promptAppend: string; tools?: string[] }>;
  build: CommandSpec;
  test: CommandSpec;
  evaluation: { criteria: Criterion[] };
}
```

### オーケストレーションフロー

```
User Request
  ↓
[Classifier] → ProjectSpec (type, features, complexity)
  ↓
[RecipeLoader] → Recipe
  ↓
[WorkspaceManager] → isolated worktree
  ↓
[Director] → PRD/GDD (workspace/spec.md)
  ↓
[Architect] → tech design (workspace/design.md)
  ↓
[Scaffold] → template展開
  ↓
┌─ LOOP (max N) ──────────────────────────────┐
│  [Programmer] → 実装                        │
│  [Build] → ビルド検証                        │
│  [Tester] → 自動テスト + E2E                │
│  [Reviewer] → コードレビュー                 │
│  [Evaluator] → 完成度スコア                 │
│  → if complete: break                       │
│  → if breaker triggered: halt & notify      │
│  [Director] → 次スプリント計画               │
└─────────────────────────────────────────────┘
  ↓
[Report] → workspace/<proj>/REPORT.md
```

---

## 実装フェーズ

以下の順で実装せよ。**各フェーズ完了時に必ず関連 README.md を更新**すること（R1）。

### Phase 0: 基盤

1. プロジェクト初期化（pnpm, tsconfig, eslint, prettier, vitest）
2. ルート `README.md` に本指示書の要約を転記（システム仕様として恒久保存）
3. `core/types.ts` に全インターフェース定義
4. `.env.example` に `ANTHROPIC_API_KEY` 記述

### Phase 1: コア層

5. `core/workspace-manager.ts` 実装（git worktreeベース）
6. `core/recipe-loader.ts` 実装（YAMLスキーマ検証込み）
7. `core/agent-factory.ts` 実装（base prompt + recipe override合成）
8. `core/circuit-breaker.ts` 実装
9. `core/metrics.ts` 実装
10. `core/orchestrator.ts` 実装

### Phase 2: 汎用エージェント群

11. `agents/director/` （プロンプト + 実装 + README）
12. `agents/architect/`
13. `agents/programmer/`
14. `agents/tester/`（Playwright統合）
15. `agents/reviewer/`
16. `agents/evaluator/`
17. `core/classifier.ts` 実装

### Phase 3: レシピ基盤

18. `recipes/README.md` にレシピ仕様書を記述
19. `recipes/_template/` を作成（新レシピのひな形）
20. `recipes/2d-game/` 実装（Phaser 3 + TypeScript + Vite）
21. E2Eテスト: 「シンプルな避けゲーを作って」で完動すること

### Phase 4: 2種別目で抽象化検証

22. `recipes/web-app/` 実装（Next.js + Tailwind）
23. E2Eテスト: 「Todoアプリを作って」で完動すること
24. 抽象化が正しいかリファクタ判断

### Phase 5: メタエージェント

25. `meta/recipe-builder.ts` 実装
    - 入力: レシピ種別の説明（例:「Electron製デスクトップアプリ」）
    - 処理: `_template/` をコピー → 各ファイルを種別に合わせて書き換え → ビルド/テスト検証 → README生成
    - 出力: `recipes/<new-type>/` に完動レシピ一式

### Phase 6: レシピ拡充（メタエージェント経由）

26. CLI `npx uaf add-recipe mobile-app "React Native Expo"` で自動追加
27. 以下を順次追加: `3d-game`, `mobile-app`, `desktop-app`, `cli`, `api`

### Phase 7: CLI と DX

28. `scripts/create.ts`: `npx uaf create "<request>"` でフル実行
29. `scripts/add-recipe.ts`: レシピ自動追加
30. 進捗のリアルタイム表示（各エージェントの状態）
31. ルート `README.md` を完成版に更新

---

## レシピ定義スキーマ（`recipe.yaml`）

```yaml
meta:
  type: web-app
  version: 1.0.0
  description: Next.js + Tailwindによるモダンなウェブアプリ

stack:
  language: typescript
  framework: nextjs
  deps:
    - next@latest
    - react@latest
    - tailwindcss

scaffold:
  type: generator # template | generator
  command: 'npx create-next-app@latest --typescript --tailwind --app'

agents:
  programmer:
    promptAppend: |
      Next.js App Routerの規約に従うこと。
      Server ComponentsとClient Componentsを適切に使い分けること。
    additionalTools: []
  tester:
    promptAppend: |
      Playwright E2Eを使用。主要ユーザーフローを最低3つカバー。

build:
  command: pnpm build
  timeoutSec: 180

test:
  command: pnpm test && pnpm test:e2e
  timeoutSec: 300

evaluation:
  criteria:
    - id: builds
      description: エラーなくビルド完了
      required: true
    - id: e2e-pass
      description: E2E全通過
      required: true
    - id: a11y
      description: Lighthouse a11y 90+
      required: false
    - id: responsive
      description: モバイル・デスクトップ両対応
      required: true
```

---

## コーディング規約

- 関数は単一責任、1ファイル1責務
- `any` 禁止、`unknown` + type narrowing を使用
- 非同期処理は必ず try/catch + 構造化ログ
- LLM呼び出しは `core/metrics.ts` 経由で記録
- エージェントのプロンプトは `prompt.md` に分離し、`index.ts` から読み込む
- テストカバレッジ 60% 以上（コア層は 80% 以上）

---

## 完了条件

1. `pnpm install && pnpm build` がエラーなく通る
2. `pnpm test` が全通過
3. `npx uaf create "2Dの避けゲーを作って"` でブラウザで遊べるゲームが生成される
4. `npx uaf create "シンプルなTodoアプリを作って"` で動くWebアプリが生成される
5. `npx uaf add-recipe cli "Node.js製コマンドラインツール"` で新レシピが自動追加される
6. 追加したレシピで `npx uaf create "CSV整形CLI"` が完動する
7. すべてのディレクトリに最新の `README.md` が存在する
8. ルート `README.md` に上記の使い方が全て記載されている

---

## 着手方法

まずこのファイル（`CLAUDE_CODE_PROMPT.md`）を `/docs/spec.md` としてプロジェクト内に保存し、仕様の原典として保持せよ。その後 Phase 0 から順次進めること。

各フェーズ完了時に以下を必ず実行:

- 該当 README の更新（R1）
- 変更履歴への追記
- 短い動作確認（最小限のスモークテスト）

不明点がある場合は、憶測で進めず `QUESTIONS.md` に書き出してから判断を仰ぐこと。
