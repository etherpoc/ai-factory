# `cli/` — `uaf` CLI

Phase 7 で導入された `uaf` コマンドの実装層。Phase 6 までは `scripts/run.ts` / `scripts/add-recipe.ts` が直接エントリだったが、それらは後方互換のラッパーに退き、**実体はこの `cli/` 配下に集約**される。

## 原則

- `cli/` は上位レイヤ。`core/`, `agents/`, `meta/` を参照してよい。**逆向きの参照は禁止**。
- 起動時の import を最小化し、`commander` の `parseAsync` まで重いモジュール (Claude SDK / orchestrator) を読み込まない。
- **ユーザー向け出力**はここ (`cli/ui/*`) が担当し、エージェント内部の構造化ロギング (`pino`) は `core/logger.ts` に任せる。この 2 つを混ぜない。

## ディレクトリ構成

```
cli/
├── README.md              # このファイル
├── index.ts               # commander ベースのコマンドルーター
├── commands/              # 各コマンドの実装 (Phase 7.3〜7.5)
│   ├── create.ts
│   ├── add-recipe.ts
│   ├── iterate.ts
│   ├── list.ts
│   ├── open.ts
│   ├── recipes.ts
│   ├── cost.ts
│   ├── clean.ts
│   ├── config.ts
│   └── doctor.ts
├── interactive/           # 対話ウィザード (Phase 7.4)
│   ├── wizard.ts
│   └── prompts.ts
├── config/                # 設定ファイルマージ (Phase 7.2)
│   ├── loader.ts
│   ├── schema.ts
│   └── defaults.ts
├── ui/                    # ユーザー向け出力
│   ├── logger.ts
│   ├── errors.ts
│   └── colors.ts
└── utils/                 # 汎用ヘルパ
    ├── workspace.ts
    ├── editor.ts
    └── duration.ts
```

## エントリーポイント

- `bin/uaf.js` が `tsx/esm/api` を `register()` してから `cli/index.ts` を動的 import する。
- `package.json` の `bin` フィールドが `./bin/uaf.js` を指す。
- `pnpm link --global` で `uaf` コマンドがシェル PATH に登録される。

## 共通フラグ

全コマンドで以下のフラグを共有する:

- `--verbose` — 詳細ログとフルスタックトレースを表示。**コマンドの前後どちらに置いても同じ挙動**（`uaf --verbose doctor` も `uaf doctor --verbose` も同じ）。ドキュメント上の **推奨位置は UNIX 慣例に従いコマンド後** (`uaf <cmd> --verbose`)。
- `--help` — コマンドのヘルプ。サブコマンドでも階層的に動作（`uaf config --help` で 4 サブコマンド、`uaf config get --help` で詳細）。

## 終了コード

| code | 意味 | 投げる UafError コード例 |
|---|---|---|
| 0 | 成功 | — |
| 1 | 一般エラー（未分類） | （デフォルトフォールスルー） |
| 2 | CLI 引数の誤り | commander が自動発行 |
| 3 | 未実装 | `NOT_IMPLEMENTED` |
| 4 | 設定エラー | `CONFIG_INVALID`, `CONFIG_PARSE_ERROR`, `CONFIG_WRITE_FAILED` |
| 5 | 実行時エラー | `BUDGET_EXCEEDED`, `CIRCUIT_BREAKER_TRIPPED`, `PHASE_C_EVIDENCE_MISSING`, `BUILD_FAILED`, `TEST_FAILED` |
| 6 | 環境エラー | `API_KEY_MISSING`, `PNPM_MISSING`, `PLAYWRIGHT_MISSING`, `NODE_VERSION` |
| 7 | 対象が見つからない | `PROJECT_NOT_FOUND`, `RECIPE_NOT_FOUND`, `WORKSPACE_NOT_FOUND`, `CONFIG_NOT_FOUND` |
| 8 | ユーザー中断 | `USER_ABORT` |

マッピングは `cli/ui/exit-codes.ts` の `CODE_TO_EXIT` テーブルで確定。カスタムコードは `UafError({ details: { exitCode: N } })` で上書き可能。Phase 9 の CI 統合で分岐条件として利用する。

## 変更履歴

- **2026-04-22 (Phase 7.7)**: 統合テスト 23 件追加（list-integration 6、cost-integration 5、clean-integration 4、config-command 8）で累計 288 件 pass。E2E: `uaf create --recipe cli --max-iterations 1 --budget-usd 0.50` + `uaf iterate <pid>` の 1 往復を実機で完遂。state.json が create→iterate 間で正しく追記されることを確認。commander の `--` separator 規約を iterate のヘルプと COMMANDS.md に明記（`uaf iterate pid --dry-run -- "--name …"`）。
- **2026-04-22 (Phase 7.6)**: ドキュメント。README を Phase 7 版に全面書き換え、`docs/COMMANDS.md` / `docs/RECIPES.md` 新設。`uaf cost` は「現存 workspace の累計のみ、真値は Anthropic Console」の乖離原因を明文化。
- **2026-04-22 (Phase 7.5)**: 残り 8 コマンドを実装。
  - `list` / `recipes` / `cost` / `doctor` — 読み取り専用系（LLM 非依存）
  - `config get/set/list/edit` — YAML 読み書き、allowlist 検証、`openInEditor` 経由のエディタ起動
  - `open` — workspace を `$EDITOR` で開く、web-app は browser hint
  - `clean` — `workspace/<proj-id>/` と `workspace/.snapshots/*` を `--older-than` で一括削除。`--dry-run` + 確認プロンプト (`--yes` でスキップ)
  - `iterate` — Q1(B) ツール経由の context 取り込み、Q2(D) mtime+size+sha256 snapshot+diff、Q3(G) 事前テストチェック → 全テスト実行、Q4(J) `--dry-run` は LLM 呼ばず。追加提案1 の `.snapshots/` 事前コピーと追加提案2 のデフォルト max_iterations=1 を適用
  - `cli/utils/{workspace,duration,editor,snapshot}.ts` 新設。state.json スキーマを zod で固定
  - `cli/commands/create.ts` は正常完了時に state.json を書き込む (iterate/list/open/clean が参照)
  - 新規テスト 38 件（workspace-util 12、snapshot 6、duration 4、iterate-preconditions 5、+ 既存カバレッジ強化）
- **2026-04-22 (Phase 7.4)**: 対話ウィザード導入。`cli/interactive/{prompts,wizard}.ts`、トップメニュー + create/add-recipe の scripted-prompter テスト。`runCreate` / `runAddRecipe` は純粋ロジックに変更し、ウィザードへの分岐は commander action handler が担当する設計に再構成。
- **2026-04-22 (Phase 7.3)**: `cli/commands/create.ts` と `cli/commands/add-recipe.ts` を実装。`scripts/run.ts` / `scripts/add-recipe.ts` は薄いラッパーに退避（外部 I/F は Phase 6 と完全互換）。共通ロジックは `_run-helpers.ts` に集約（`BudgetTracker` / `budgetedStrategy` / `summarizeMetrics` / `formatRunSummary`）。`BudgetTracker` 超過時は `UafError(BUDGET_EXCEEDED)` → exit 5。`API_KEY_MISSING` / `CIRCUIT_BREAKER_TRIPPED` / `RECIPE_BUILD_FAILED` の stable な UafError code を追加。
- **2026-04-22 (Phase 7.2)**: `cli/config/` を新設。`schema.ts` (zod strict)、`defaults.ts`、`loader.ts` で `~/.uaf/config.yaml` と `./.uafrc` をマージ。`AGENT_ROLES` は core の `DEFAULT_MODELS_BY_ROLE` と drift しないよう回帰テストで固定。
- **2026-04-22 (Phase 7.1)**: CLI 基盤作成。`cli/index.ts` に commander ルーター、`cli/ui/{colors,logger,errors,exit-codes}.ts` を配置。`bin/uaf.js` を新設し、`package.json` の bin を更新。全 10 コマンドのスタブ登録 (実装は 7.3 以降)。`--verbose` はコマンドの前後どちらでも動作することを回帰テストで固定。終了コードポリシー（0〜8）を定義し Phase 9 CI 統合の前準備を完了。
