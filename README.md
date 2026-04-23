# Universal Agent Factory (UAF)

> 自然言語リクエストから、**ゲーム・Web アプリ・モバイルアプリ・デスクトップアプリ・CLI・API を完全自動で生成**するマルチエージェントシステム。

**Phase 7.8 (Spec-Roadmap-Resume-Preview) 完走版**。`uaf` コマンド 1 つで **13 種類の操作**を提供する個人用プロトタイピング道具。

---

## Quick start

```bash
# 1. セットアップ
pnpm install
cp .env.example .env        # ANTHROPIC_API_KEY を書く
                            # Phase 11.a で creative 機能を使うなら
                            # REPLICATE_API_TOKEN と ELEVENLABS_API_KEY も追加

# 2. uaf コマンドをグローバル化（初回のみ）
pnpm link --global
uaf --help                   # 動作確認
uaf doctor                   # 環境 10 項目チェック

# 3. 最初のプロジェクト (Phase 7.8: spec → roadmap → build の新フロー)
uaf create "2Dの避けゲーム" --budget-usd 1.50 --asset-budget-usd 1.00
# → interviewer が 3〜7 個の質問を投げる
# → spec.md が提示される → y/N/e で承認
# → roadmap-builder が 8〜15 タスクのロードマップを生成
# → 実装開始 → workspace/<projectId>/ に絵と音付きのコードが生成される
# → REPORT.md / spec.md / roadmap.md / state.json / assets-manifest.json / audio-manifest.json / copy.json / critique.md

# 4. 途中で中断したら (Ctrl+C または PC 再起動)
uaf list --incomplete        # 中断プロジェクトを一覧
uaf status <projectId>       # phase / 進捗 / per-task badges を確認
uaf resume <projectId>       # 中断地点から再開 (完了済み task はスキップ)

# 5. 完成したら即プレビュー (レシピ別ハンドラ)
uaf preview <projectId>      # vite dev / next dev / expo / electron 自動起動 + ブラウザオープン
# Ctrl+C で停止、または: uaf preview --stop <projectId>
# バックグラウンド起動: uaf preview <projectId> --detach

# 6. 差分を加えたくなったら
uaf iterate <projectId> "BGM を追加" --dry-run     # まずドライラン
uaf iterate <projectId> "BGM を追加" --budget-usd 0.50

# 7. 何がどれだけかかったか
uaf cost
uaf list                     # PHASE + PROGRESS 列も表示
```

### Phase 7.8 以前の直接フロー（spec 対話なし）

```bash
# --no-spec で Director 直呼びの legacy フローに戻せる
uaf create "CSV 整形 CLI" --recipe cli --no-spec --budget-usd 0.50

# CI / スクリプトでは事前 spec.md を渡す
uaf create --spec-file ./my-spec.md --recipe 2d-game --yes
```

### グローバルインストール手順（詳細）

`pnpm link --global` でこの repo の `bin/uaf.js` をシェル PATH に登録する。どのディレクトリからでも `uaf` が使える。

```powershell
cd C:\Users\ether\workspace\ai-factory
pnpm link --global
uaf --help                   # 表示されれば OK
```

アンリンクしたいとき:

```powershell
pnpm unlink --global universal-agent-factory
```

`bin/uaf.js` は tsx ESM loader 経由で `cli/index.ts` を動的ロードする（ビルド不要）。グローバル化後に repo のコードを変更すると即座に反映される。

---

## コア原則

| ID | 原則 | 要旨 |
|---|---|---|
| R1 | **README ファースト** | 仕様変更は README を先に更新する |
| R2 | **レシピ拡張** | 新種別は `recipes/<type>/` 追加のみ。`core/` 無改修 |
| R3 | **決定論的検証** | ビルド・Lint・テスト・E2E の機械判定のみで「完成」を判定 |
| R4 | **サーキットブレーカー** | 同一エラー 3 連続 or 最大イテレーション到達で停止 |
| R5 | **コスト可観測性** | 全 LLM 呼び出しを `workspace/<proj>/metrics.jsonl` に記録 |

## 13 コマンド

| コマンド | 用途 | 対話モード |
|---|---|---|
| `uaf create <request>` | プロジェクト生成 (Phase 7.8: spec → roadmap → build フロー) | ✓ |
| `uaf add-recipe --type X --description Y` | レシピ追加 | ✓ |
| `uaf iterate <proj-id> <request>` | 差分追加 | — |
| `uaf list [--incomplete]` | プロジェクト一覧（Phase 7.8: `--incomplete` で中断中のみ） | — |
| `uaf open <proj-id>` | エディタで開く | — |
| `uaf recipes` | レシピ一覧 | — |
| `uaf cost [--period all\|today\|week\|month]` | コスト集計 | — |
| `uaf clean [--older-than 30d] [--incomplete]` | 古い workspace 削除 | — |
| `uaf config get/set/list/edit` | 設定操作 | — |
| `uaf doctor` | 環境チェック | — |
| `uaf status <proj-id>` | **(Phase 7.8)** phase / 進捗 / per-task の可視化 | — |
| `uaf resume <proj-id>` | **(Phase 7.8)** 中断プロジェクトの再開 | — |
| `uaf preview <proj-id>` | **(Phase 7.8)** レシピ別に dev server 起動 | — |

- 引数なしで `uaf` を実行するとトップレベルの対話ウィザード
- 共通フラグ: `--verbose`（前後どちらでも有効）、`--help`
- 終了コード: 0=成功 / 2=引数エラー / 4=設定エラー / 5=実行時 / 6=環境 / 7=対象なし / 8=ユーザー中断

詳細は [`docs/COMMANDS.md`](./docs/COMMANDS.md)。

## アーキテクチャ

```
bin/uaf.js              ← shebang launcher (tsx/esm/api で TS を直接ロード)
  └─ cli/index.ts       ← commander ルーター + dotenv + SIGINT ハンドラ install
       ├─ cli/commands/ ← 13 コマンドの実装 (create / iterate / status / resume / preview ほか)
       ├─ cli/config/   ← YAML 2 層マージ (project > global > defaults)
       ├─ cli/interactive/ ← 対話ウィザード + spec-wizard (@inquirer/prompts)
       ├─ cli/ui/       ← logger / errors / colors / exit-codes
       └─ cli/utils/    ← workspace / snapshot / duration / editor / ports

core/                   ← オーケストレーション基盤 (CLI 非依存)
  ├─ orchestrator.ts    ← メインループ (Phase 7.8: existingWorkspace / skipScaffold)
  ├─ classifier.ts      ← ヒューリスティック分類
  ├─ recipe-loader.ts   ← YAML + zod 検証
  ├─ agent-factory.ts   ← エージェント合成
  ├─ workspace-manager.ts ← プロジェクト隔離 (plain-directory, F6)
  ├─ strategies/claude.ts ← Claude Agent SDK wrapper (F14/F17/F18)
  ├─ tools/             ← read_file / write_file / edit_file / list_dir / bash / ask_user / generate_image / generate_audio
  ├─ pricing.ts         ← F14 現行モデルレート
  ├─ state.ts           ← (Phase 7.8) state.json zod スキーマ + atomic I/O
  ├─ checkpoint.ts      ← (Phase 7.8) writeTaskCheckpoint / writeInterruptCheckpoint
  ├─ signal-handler.ts  ← (Phase 7.8) SIGINT idempotent install + 二段階強制終了
  ├─ resume.ts          ← (Phase 7.8) planResume 純粋関数 (5 ブランチ)
  ├─ roadmap-builder.ts ← (Phase 7.8) JSON 抽出 + zod + topological sort
  └─ utils/atomic-write.ts ← (Phase 7.8) tmp→fsync→rename + Windows EPERM/EBUSY リトライ

agents/                 ← 汎用 12 エージェント (6 base + 4 creative + interviewer + roadmap-builder)
recipes/                ← プロジェクト種別テンプレート (7 種類)
meta/                   ← recipe-builder メタエージェント (Phase 5, F19)
scripts/                ← レガシーラッパー + 運用ユーティリティ + e2e-phase7-8.ts
tests/                  ← 462 件の vitest (unit + 回帰 + CLI + E2E)
workspace/              ← .gitignore 配下、生成物の隔離先
```

## 設定

デフォルトを変えたいときは `~/.uaf/config.yaml` か `./.uafrc`:

```yaml
budget_usd: 1.50
max_iterations: 3
max_rounds: 30
workspace_location: ~/Documents/uaf-workspace
models:
  programmer: claude-sonnet-4-6
editor: code
```

優先順位: **project > global > built-in defaults**。詳細は [`cli/config/README.md`](./cli/config/README.md)。

## LLM モデルポリシー

| ロール | モデル |
|---|---|
| director / architect / programmer | Sonnet 4.6 |
| tester / reviewer / evaluator | Haiku 4.5 |
| artist / sound / writer / critic | Sonnet 4.6 (Phase 11.a) |
| interviewer / roadmap-builder | Sonnet 4.6 (Phase 7.8、対話品質 + 構造化出力の信頼性のため) |
| classifier | ヒューリスティック（LLM 非使用） |

**Opus 4.7 は opt-in のみ**。デフォルトルートには含めず、明示選択時は `resolveModel` が `opt-in warn` を発火（F18）。

価格は `core/pricing.ts` を唯一の真値として扱う（F14）。`uaf cost` と `scripts/recompute-metrics.ts` は同じ `computeCost` 関数を共有。

## レシピ

7 種別搭載（2d-game / 3d-game / web-app / mobile-app / desktop-app / cli / api）。追加は `uaf add-recipe` でメタエージェント経由、または手動。詳細は [`docs/RECIPES.md`](./docs/RECIPES.md)。

## テストと検証

```bash
pnpm test                              # 全テスト (462 件)
pnpm tsx scripts/check-recipes.ts      # F19 構造検証
pnpm exec tsc --noEmit                 # 型チェック
uaf doctor                             # 環境 10 項目チェック
pnpm tsx scripts/e2e-phase7-8.ts       # Phase 7.8 実 LLM E2E (~$2)
```

## 実装フェーズ

| Phase | 内容 | 状態 |
|---|---|---|
| 0 | 基盤 | ✅ |
| 1 | コア層 | ✅ |
| 2 | 汎用エージェント + classifier | ✅ |
| 3 | レシピ基盤 + 2d-game | ✅ |
| 4 | web-app + 抽象化検証 | ✅ |
| 5 | メタエージェント recipe-builder | ✅ |
| 6 | レシピ拡充（cli / api / 3d-game / mobile / desktop） | ✅ |
| **7** | **CLI & DX** | ✅ |
| 8 | ビルド・パッケージング | ⏳ |
| 9 | デプロイ・公開自動化 | ⏳ |
| 10 | ストア公開支援 (itch.io / Vercel / App Store / Google Play) | ⏳ |
| 11 | Creative/Ops 拡張 | 未定 |

## トラブルシューティング

| 症状 | 対処 |
|---|---|
| `uaf doctor` で ANTHROPIC_API_KEY missing | `.env.example` を `.env` にコピーしてキーを記入 |
| `uaf create` が Phase C で落ちる | `--max-rounds 60` で再試行、または `--verbose` で詳細確認 |
| `uaf iterate` が `REGRESSION_PRECONDITION_FAILED` | 先に既存テストを修正。iterate は green 状態でないと走らない |
| Windows で長い日本語 workspace パスで pnpm が失敗 | F20 で projectId を `<timestamp>-<hash>` に短縮済み。古い workspace は `uaf clean` で削除可 |
| 累計コストが Console と合わない | `uaf cost` は現存 workspace 分のみ。真値は [console.anthropic.com](https://console.anthropic.com/) |

## 参照ドキュメント

- [`docs/COMMANDS.md`](./docs/COMMANDS.md) — 全コマンドのリファレンス
- [`docs/RECIPES.md`](./docs/RECIPES.md) — レシピ追加ガイド
- [`docs/spec-phase7.md`](./docs/spec-phase7.md) — Phase 7 設計原典
- [`docs/spec.md`](./docs/spec.md) — Phase 0〜6 の仕様原典
- [`PROJECT_STATUS_REPORT.md`](./PROJECT_STATUS_REPORT.md) — 現状と将来計画
- [`FINDINGS.md`](./FINDINGS.md) — 発見事項と教訓
- [`cli/README.md`](./cli/README.md) — CLI 実装層
- [`core/pricing.ts`](./core/pricing.ts) — モデル価格の唯一の真値

## 変更履歴 (Phase 7)

- **2026-04-22 (Phase 7.1)**: CLI 基盤 (`bin/uaf.js` + `cli/index.ts` + `cli/ui/*`)。`--verbose` の位置非依存、exit codes 0〜8 ポリシー。
- **2026-04-22 (Phase 7.2)**: `cli/config/` (zod strict + 2 層マージ)。`AGENT_ROLES` と `DEFAULT_MODELS_BY_ROLE` の drift 検出テスト。
- **2026-04-22 (Phase 7.3)**: `create` / `add-recipe` 実装、`scripts/run.ts` / `scripts/add-recipe.ts` は薄いラッパーに退避。
- **2026-04-22 (Phase 7.4)**: 対話ウィザード (`@inquirer/prompts`)。`runCreate` / `runAddRecipe` を純粋関数化、分岐は commander action に移動。
- **2026-04-22 (Phase 7.5)**: 残り 8 コマンド (`iterate` / `list` / `open` / `recipes` / `cost` / `clean` / `config` / `doctor`)。`state.json` と `.snapshots/` による iterate 安全装置。
- **2026-04-22 (Phase 7.6)**: ドキュメント整備 (README 書き換え、COMMANDS.md / RECIPES.md 新設)。
- **2026-04-22 (Phase 7.7)**: 統合テスト + E2E (create → iterate 1 往復の実機検証)。

## ライセンスと利用

個人ツール前提。OSS 公開や商用化は当面考えていない。
