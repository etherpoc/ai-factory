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
├── commands/              # 各コマンドの実装 (Phase 7.3〜7.8)
│   ├── create.ts          # Phase 7.8: spec→roadmap→build (--no-spec で legacy)
│   ├── add-recipe.ts
│   ├── iterate.ts
│   ├── list.ts            # Phase 7.8: --incomplete / --all / PHASE 列
│   ├── open.ts
│   ├── recipes.ts
│   ├── cost.ts
│   ├── clean.ts           # Phase 7.8: --incomplete オプション
│   ├── config.ts
│   ├── doctor.ts
│   ├── status.ts          # Phase 7.8: 進捗 / phase / per-task badges
│   ├── resume.ts          # Phase 7.8: 中断プロジェクトの再開
│   └── preview.ts         # Phase 7.8.6: 種別別 dev サーバ起動
├── interactive/           # 対話ウィザード (Phase 7.4 / 7.8.2)
│   ├── wizard.ts
│   ├── prompts.ts
│   └── spec-wizard.ts     # Phase 7.8.2: interviewer 駆動の spec 生成
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

- **2026-04-23 (Phase 7.8)**: spec→roadmap→build フローを追加、3 新コマンド (`status` / `resume` / `preview`) を追加。
  - **7.8.4**: `cli/commands/create.ts` を改修。`--no-spec` で legacy 直接フロー、デフォルトで spec dialogue → roadmap-builder → 承認 → build。`--spec-file` で対話スキップ、`-y/--yes` で承認自動化。各フェーズで state.json checkpoint。`cli/commands/status.ts` 新設（phase / progress / per-task badges / cost / legacy detection / JSON 出力）。
  - **7.8.5**: `cli/commands/resume.ts` 新設。`core/resume.ts` の `planResume()` 純粋関数で 5 ブランチ判定（not-resumable / already-complete / rerun-spec / rerun-roadmap / continue-build）。filesystem survey で warning。`cli/commands/list.ts` に `--incomplete` / `--all` + PHASE 列。`cli/commands/clean.ts` に `--incomplete` (resumable も対象に)。
  - **7.8.6**: `cli/commands/preview.ts` 新設。7 レシピ別ハンドラ (vite × 2、next、api、cli、Expo、Electron)。`cli/utils/ports.ts` の `findFreePort()` で 5173/3000/4173/8080 衝突時に上方向探索、選択ポートをユーザー表示。`--detach`（unref + state.preview に pid+port 記録）/ `--stop <id>` / `--stop-all` / `--run "<args>"`（cli 専用）/ `--no-open` / `--port <n>`。
  - **インタビュー早期試走** (`scripts/trial-interviewer.ts`): 2d-game + web-app の対話 UX を実 LLM で確認、テンプレートが正しく切り替わることを検証 (合計 ~$0.18)。
  - 累計テスト 462 件 green、tsc クリーン、Opus 0 calls。
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
