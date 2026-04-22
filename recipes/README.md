# recipes/ — プロジェクト種別レシピ

## 概要

プロジェクト種別（2D ゲーム、Web アプリ、CLI …）ごとの設定・スキャフォールド・エージェント特化プロンプトを束ねたもの。**コア層の変更なしに新種別を追加可能**にする（R2）。

## レシピ構成（必須ファイル）

```
recipes/<type>/
├── README.md        # このレシピの仕様・使い方
├── recipe.yaml      # メタ・スタック・build/test/評価基準
├── prompts/
│   ├── director.md      (optional)
│   ├── architect.md     (optional)
│   ├── programmer.md    (optional — promptAppend 相当)
│   ├── tester.md        (optional)
│   ├── reviewer.md      (optional)
│   └── evaluator.md     (optional)
└── template/        (scaffold.type=template の場合)
```

## recipe.yaml スキーマ

正式な zod スキーマは `core/recipe-loader.ts` を参照。必須フィールドと推奨値:

| フィールド                              | 型                                                           | 必須 | 備考                                                                    |
| --------------------------------------- | ------------------------------------------------------------ | ---- | ----------------------------------------------------------------------- |
| `meta.type`                             | string                                                       | ✓    | **ディレクトリ名と一致させる**（loader が突き合わせる）                 |
| `meta.version`                          | string                                                       | ✓    | セマンティックバージョン                                                |
| `meta.description`                      | string                                                       | ✓    | 一行説明                                                                |
| `stack.*`                               | `{language, framework, deps[]}`                              | ✓    | evaluator やログ表示に使われる                                          |
| `scaffold`                              | `{type: 'template', path}` or `{type: 'generator', command}` | ✓    | template は `recipes/<type>/<path>` を worktree に `cp -r`              |
| `agentOverrides.<role>.promptAppend`    | string                                                       |      | `agents/<role>/prompt.md` に連結される                                  |
| `agentOverrides.<role>.additionalTools` | string[]                                                     |      | orchestrator の `toolRegistry` に存在する名前                           |
| `build`, `test`                         | `{command, timeoutSec, env?}`                                | ✓    | timeoutSec はミリ秒ではなく **秒**                                      |
| `evaluation.criteria`                   | `{id, description, required}[]`                              | ✓    | `id` は `builds` / `tests-pass` / `e2e-pass` など、evaluator が知るキー |

最小例 (`2d-game`):

```yaml
meta:
  type: 2d-game
  version: 1.0.0
  description: Phaser 3 + TypeScript + Vite
stack:
  language: typescript
  framework: phaser3
  deps: [phaser, vite, '@playwright/test']
scaffold:
  type: template
  path: template
agentOverrides:
  programmer:
    promptAppend: 'Phaser 3 の Scene パターンに従う'
build:
  command: 'pnpm install --prefer-offline && pnpm build'
  timeoutSec: 300
test:
  command: 'pnpm exec playwright install --with-deps chromium && pnpm exec playwright test'
  timeoutSec: 600
evaluation:
  criteria:
    - { id: builds, description: vite build が 0 で終了, required: true }
    - { id: tests-pass, description: Playwright 全通過, required: true }
    - { id: canvas-boots, description: 起動で canvas が描画される, required: true }
```

## 新レシピを追加する方法

### A. メタエージェント経由（推奨）

```
npx uaf add-recipe mobile-app "React Native Expo"
```

`meta/recipe-builder.ts` が `_template/` を複製し、種別特化の書き換え + 検証 + README 生成まで行う。

### B. 手動

1. `cp -r recipes/_template recipes/<new-type>`
2. `recipe.yaml` をそのスタックに合わせて書き換え
3. `README.md` を更新
4. `tests/recipes/<new-type>.test.ts` を追加してスモーク検証

## トラブルシューティング

- **`recipe.yaml` スキーマエラー**: `core/recipe-loader.ts` のバリデータが行番号付きで失敗を吐く。
- **scaffold コマンドがタイムアウト**: `build.timeoutSec` ではなく scaffold 用タイムアウトをレシピ側で拡張。

## 現在のレシピ一覧

| type          | ステータス                            | スタック                           | ディレクトリ                  |
| ------------- | ------------------------------------- | ---------------------------------- | ----------------------------- |
| `2d-game`     | 完了                                  | Phaser 3 + TypeScript + Vite       | [2d-game/](./2d-game)         |
| `web-app`     | 完了                                  | Next.js 14 App Router + Tailwind   | [web-app/](./web-app)         |
| `cli`         | **自動生成** (Phase 5)                | Node.js + commander + tsx + vitest | [cli/](./cli)                 |
| `api`         | **自動生成** (Phase 5.1)              | Hono + Node + vitest + supertest   | [api/](./api)                 |
| `3d-game`     | **自動生成** (Phase 6)                | Three.js + Vite + Playwright       | [3d-game/](./3d-game)         |
| `mobile-app`  | **自動生成（F19 後パッチレス再生成）** (Phase 6) | Expo 51 + expo-router + jest-expo  | [mobile-app/](./mobile-app)   |
| `desktop-app` | **自動生成** (Phase 6)                | Electron + Vite + React + vitest   | [desktop-app/](./desktop-app) |
| `_template`   | 雛形                                  | —                                  | [\_template/](./_template)    |

## 変更履歴

- 2026-04-21 (Phase 0): 初版（スタブ）。
- 2026-04-21 (Phase 3): `_template/` に recipe.yaml + prompts/programmer.md + template/.gitkeep を配置。`2d-game/` を実装（Phaser 3 + Vite + Playwright の雛形、エージェントオーバーライド、評価基準 3 項目）。scaffold は template 型で `recipes/<type>/template/` を `cp -r` する仕様に。
- 2026-04-21 (Phase 4): `web-app/` を実装（Next.js 14 App Router + Tailwind + Playwright Desktop/Mobile の雛形、評価基準: builds / tests-pass / responsive）。**コア層は無改修で追加完了**（R2 検証）。
- 2026-04-22 (Phase 5): `cli/` を **`meta/recipe-builder.ts` 経由で自動生成**（$0.54）。`_template/` をクローンして Claude が in-place で書き換え → schema 検証 → アトミック rename。生成後、`scripts/run.ts --recipe cli` で end-to-end 実働確認済み（programmer が npm install + tsc + vitest を成功させて CLI コード生成、$0.40）。build/test コマンドの `pnpm install` 欠落のみ手動パッチ。
- 2026-04-22 (Phase 5.1 — install-required 強化後): `api/` を自動生成（$0.35、120s、24 tool calls）。Hono + vitest + supertest 構成。recipe-builder が自力で `pnpm install && tsc --noEmit && vitest run` を tmp 内で走らせて事前検証するようになり、install 欠落は再発せず。
- 2026-04-22 (Phase 6 開始): `3d-game/` を `--reference 2d-game` 経由で自動生成（$0.43、148s、38 tool calls）。recipe-builder が `bash('cat ../../../recipes/2d-game/recipe.yaml')` などで既存 2d-game の構造を体系的に学習してから Three.js + Vite 相当に書き換え。生成レシピで end-to-end 検証（$0.47）、smoke と gameplay の Playwright テストが両方 pass（キューブが回転 + ArrowLeft/Right で移動）。
- 2026-04-22 (Phase 6 継続): `mobile-app/` を `--reference web-app` で自動生成（$0.555、192s、45 tool calls）。Expo SDK 52 + expo-router + Jest 構成。**max-rounds 29 到達で self-verify と recipe-level README が skip → 手動補完**（Maestro opt-in 手順付き README、`@types/jest`、`transformIgnorePatterns` 修正）。e2e 検証で programmer は storage + FAB + navigation 付きメモアプリ骨組みを生成 ($0.70)。**発見**: React Native Expo の Jest 統合は繊細で、recipe-builder が初回で完璧に作るのは難しい（FINDINGS F19）。
- 2026-04-22 (Phase 6 — F19 対策後): meta/recipe-builder に **P0 (Phase C 自己検証の強制)** / **P1 (recipe README byte 一致 reject)** / **P2 (round 予算ガイダンス + `build/test: SKIP(reason)` 明示マーカー)** を実装。`validateBuiltRecipe` が install/build/test の bash 実行ログを評価し、証拠不足なら deterministic に rollback。
- 2026-04-22 (Phase 6 — F19 後): `mobile-app/` を `--max-rounds 45 --budget-usd 0.80` で **パッチレス再生成**（$0.92、294s、59 tool calls）。Phase C で `transformIgnorePatterns` と `@types/jest` 不足を LLM 自身が発見・修正し、手動パッチ不要で committed。
- 2026-04-22 (Phase 6 — F19 後): `desktop-app/` を `--reference web-app --max-rounds 60 --budget-usd 1.20` で自動生成（$1.04、320s、73 tool calls）。Electron + Vite + React + vitest 構成。**初回 `--max-rounds 45` ではラウンド切れで rollback**（P0 想定通り）、60 で通過。vitest v2 の projects 環境指定問題も LLM が自己解決。
