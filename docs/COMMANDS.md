# `uaf` コマンドリファレンス (Phase 7 + 11.a)

個人用プロトタイピング道具としての UAF CLI の全 10 コマンド仕様。

## インストールと起動

### グローバルインストール（推奨）

```powershell
cd C:\Users\ether\workspace\ai-factory
pnpm link --global
uaf --help                   # 動作確認
```

`pnpm link --global` で repo の `bin/uaf.js` をシェル PATH に登録する。以後どのディレクトリからでも `uaf` が使える。`bin/uaf.js` は tsx ESM loader 経由で `cli/index.ts` を動的ロードするため、repo のコード変更は即座に反映される（ビルド手順不要）。

### アンリンク

```powershell
pnpm unlink --global universal-agent-factory
```

### repo 内から直接起動（link なしの fallback）

```powershell
cd C:\Users\ether\workspace\ai-factory
node bin/uaf.js --help
```

## 全コマンド共通

- **対話モード**: 必須引数なしで実行すると対話ウィザードが起動（詳細は後述）
- **非対話モード**: 引数付きで実行すると即座に処理（スクリプト / CI から呼べる）
- **共通フラグ**: `--verbose` / `--help`
- **`--verbose` の位置**: コマンドの前後どちらでも動作（`uaf --verbose doctor` も `uaf doctor --verbose` も同じ）。**推奨位置はコマンド後** (UNIX 慣例)
- **終了コード**:

  | code | 意味 | 代表的な UafError コード |
  |---|---|---|
  | 0 | 成功 | — |
  | 1 | 一般エラー | (未分類フォールスルー) |
  | 2 | CLI 引数の誤り | `ARG_MISSING` |
  | 3 | 未実装 | `NOT_IMPLEMENTED` |
  | 4 | 設定エラー | `CONFIG_INVALID`, `CONFIG_PARSE_ERROR` |
  | 5 | 実行時エラー | `BUDGET_EXCEEDED`, `CIRCUIT_BREAKER_TRIPPED`, `REGRESSION_PRECONDITION_FAILED`, `RECIPE_BUILD_FAILED` |
  | 6 | 環境エラー | `API_KEY_MISSING`, `DOCTOR_CHECKS_FAILED` |
  | 7 | 対象なし | `PROJECT_NOT_FOUND`, `RECIPE_NOT_FOUND`, `WORKSPACE_NOT_FOUND` |
  | 8 | ユーザー中断 | `USER_ABORT` (Ctrl-C) |

## 目次

1. [`uaf create`](#uaf-create)
2. [`uaf add-recipe`](#uaf-add-recipe)
3. [`uaf iterate`](#uaf-iterate)
4. [`uaf list`](#uaf-list)
5. [`uaf open`](#uaf-open)
6. [`uaf recipes`](#uaf-recipes)
7. [`uaf cost`](#uaf-cost)
8. [`uaf clean`](#uaf-clean)
9. [`uaf config`](#uaf-config)
10. [`uaf doctor`](#uaf-doctor)

---

## `uaf create`

自然言語リクエストから新しいプロジェクトを生成する。

### 使い方

```bash
uaf create "<request>" [options]
```

### 引数

| 名前 | 必須 | 説明 |
|---|---|---|
| `<request>` | はい (対話時は省略可) | 自然言語のリクエスト |

### オプション

| フラグ | 型 | デフォルト | 説明 |
|---|---|---|---|
| `--recipe <type>` | string | (auto) | レシピ種別を強制（classifier をスキップ） |
| `--budget-usd <usd>` | number | config の `budget_usd` or `2.0` | 予算上限（USD）。超過で `BUDGET_EXCEEDED` |
| `--max-iterations <n>` | int | config の `max_iterations` or `3` | orchestrator ループ上限 |
| `--max-rounds <n>` | int | config の `max_rounds` or `30` | tool-use ラウンド上限 |
| `--model <id>` | string | per-role default | 全ロール共通のモデル強制 |
| `--cleanup` | flag | false | 完了後に workspace を削除 |

### 例

```bash
# 2D ゲーム
uaf create "2Dの避けゲーム"

# レシピを明示
uaf create "Todo アプリ" --recipe web-app --budget-usd 2.00

# 予算厳密制御
uaf create "CSV 整形 CLI" --recipe cli --budget-usd 0.50 --max-iterations 1
```

### 挙動

1. classifier または `--recipe` でレシピ種別を決定
2. `workspace/<timestamp>-<hash>/` を作成
3. Director → Architect → Scaffold → ループ (Programmer → Build → Tester → Reviewer → Evaluator)
4. 完了時 `REPORT.md` / `metrics.jsonl` / `state.json` を書き込み
5. 失敗時は halt 扱いで exit 5

### 対話モード

`uaf create`（引数なし）で request / recipe / budget / max-iterations を順に質問。

---

## `uaf add-recipe`

メタエージェント経由で新しいレシピ種別を追加。

### 使い方

```bash
uaf add-recipe --type <slug> --description "<text>" [options]
```

### オプション

| フラグ | 型 | デフォルト | 説明 |
|---|---|---|---|
| `--type <slug>` | string | 必須 | kebab-case のレシピ名 |
| `--description <text>` | string | 必須 | スタック説明 |
| `--reference <type>` | string | なし | 構造的に参考にする既存レシピ |
| `--budget-usd <usd>` | number | 0.50 | 情報用予算表示 |
| `--max-rounds <n>` | int | 30 | tool-use 上限 |

### 例

```bash
uaf add-recipe --type 3d-game-vr --description "WebXR 対応 3D ゲーム" --reference 3d-game
```

### 挙動

Phase 5 の recipe-builder に委譲。Phase C 自己検証が必須化されているため、pnpm install + tsc + build + test が通ったレシピだけが `recipes/<type>/` に atomic rename される。失敗時 `RECIPE_BUILD_FAILED` で exit 5。

---

## `uaf iterate`

既存プロジェクトに差分変更を加える。

### 使い方

```bash
uaf iterate <proj-id> "<change request>" [options]
```

### 引数

| 名前 | 必須 | 説明 |
|---|---|---|
| `<proj-id>` | はい | `workspace/<proj-id>/` のディレクトリ名 |
| `<request>` | はい | 変更内容の自然言語リクエスト |

### オプション

| フラグ | 型 | デフォルト | 説明 |
|---|---|---|---|
| `--budget-usd <usd>` | number | config の `budget_usd` or `2.0` | 予算上限 |
| `--max-iterations <n>` | int | **1** (iterate 専用デフォルト) | スプリント上限 |
| `--max-rounds <n>` | int | 30 | tool-use 上限 |
| `--dry-run` | flag | false | LLM を呼ばず計画のみ表示 |

### 例

```bash
# 単純なリクエスト（ダッシュなし）
uaf iterate 202604221242-b13689 "BGM を追加" --dry-run

# --flag を含むリクエストは UNIX の `--` セパレータで区切る
uaf iterate 202604221242-b13689 --dry-run -- "--name オプションを追加"
uaf iterate 202604221242-b13689 --budget-usd 0.50 -- "--version で help を出す"
```

**重要**: request 文字列に `--foo` のようなダッシュ表記が含まれる場合、commander が option と誤解する。`-- "…"` で明示的に position 引数であることを示す。プレーンな日本語・英語リクエストには不要。

### 挙動

1. **事前チェック**: 既存の `recipe.test.command` を実行し全テスト green を確認。落ちていたら `REGRESSION_PRECONDITION_FAILED` (exit 5) で停止
2. `--dry-run` ならここでレポートを出して終了（LLM 呼び出しなし）
3. `workspace/.snapshots/<proj-id>-<timestamp>/` に **workspace 全体をコピー**（安全装置、`uaf clean` が同じ `--older-than` ポリシーで消す）
4. mtime+size+SHA256 の 3-tuple で before snapshot
5. Programmer に iterate 指示（"preserve existing / minimal changes / no refactor"）を渡し実行（Director / Architect はスキップ）
6. Build → Test → Evaluator の 1 スプリント（`--max-iterations` で伸ばせる）
7. after snapshot、diff（added / modified / deleted / bytesΔ）を生成
8. `state.json.iterations` に追記、`ITERATE_LAST.txt` に保存
9. exit 0（done=true）or exit 5（done=false）

### iterate モードのプロンプト

Programmer の system prompt 先頭に以下を注入:

- 既存機能を壊さない（pre-check が green だったので回帰は即検知可能）
- 必要な最小ファイルのみ編集
- 指示のない refactor をしない
- 新規振る舞いにはテストを追加、既存テストを保持
- 最終応答で diff summary を出力

---

## `uaf list`

生成済みプロジェクトの一覧。

### 使い方

```bash
uaf list [options]
```

### オプション

| フラグ | 説明 |
|---|---|
| `--recipe <type>` | レシピでフィルタ |
| `--status <status>` | completed / halted / failed / in-progress でフィルタ |
| `--json` | JSON 出力 |

### 出力例

```
ID                         RECIPE     STATUS      ITERS  AGE      REQUEST
202604221242-b13689        desktop-app completed  1      2h ago   シンプルなマークダウン…
```

state.json が存在しない Phase 6 以前の workspace は `(unknown)` / `(no state)` / `-` で表示。

---

## `uaf open`

workspace をエディタ（または web 系ならブラウザヒント）で開く。

### 使い方

```bash
uaf open <proj-id> [options]
```

### オプション

| フラグ | 説明 |
|---|---|
| `--editor <cmd>` | エディタ強制（config / `$EDITOR` / `$VISUAL` を上書き） |
| `--browser` | web-app なら dev サーバ起動方法を表示 |

### エディタ解決順序

1. `--editor` フラグ
2. config の `editor` (yaml)
3. `$VISUAL` / `$EDITOR` 環境変数
4. プラットフォームデフォルト (`notepad` on Windows, `vi` on Unix)

---

## `uaf recipes`

インストール済みレシピ一覧。

### 使い方

```bash
uaf recipes [--json]
```

### 出力例

```
TYPE         VERSION  STACK                       DESCRIPTION
2d-game      1.0.0    phaser3 (typescript)        Phaser 3 + TypeScript + Vite による 2D...
3d-game      1.0.0    threejs (typescript)        Three.js + Vite + Playwright による 3D...
...
```

---

## `uaf cost`

コスト集計。

### 使い方

```bash
uaf cost [--period today|week|month|all] [--json]
```

### 重要な注意事項 — 集計の正確性

**`uaf cost` が集計するのは、コマンド実行時点で `workspace/` ディレクトリ配下に物理的に存在する `<proj-id>/metrics.jsonl` だけ**です。次の理由で **真の課金額とは乖離し得る** ため、正確な金額が必要なときは [console.anthropic.com](https://console.anthropic.com/) の Usage / CSV を真値として参照してください。

| 乖離要因 | 影響 |
|---|---|
| **`uaf clean` で削除済みの workspace** | それらの metrics.jsonl は一緒に削除されているため cost 集計に**含まれない** |
| **手動削除した workspace** | 同上 |
| **`--cleanup` 付きで起動した create** | 完了時に workspace 丸ごと削除されるため集計対象外 |
| **Anthropic 側の集計ラグ** | Console は遅延反映があるが最終的には `uaf cost` より多くなる傾向 (F18 で確認済) |
| **レシピ開発中の `uaf add-recipe`** | recipe-builder のコストは含まれている（workspace と同じ metrics 形式を使うため）**ただし tmp dir が rollback された失敗ケースは記録が残らない場合あり** |

**実例（2026-04-22 時点）**: `uaf cost --period all` は `$3.32` を報告していたが、Anthropic Console の実累計は約 `$18.60` (Phase 0〜6 通算)。差分は既に削除された Phase 3〜5 の検証 workspace と F18 調査分。

### 出力例

```
=== uaf cost (all) ===
workspace   : .../workspace
calls total : 20
tokens      : in=300446 out=76698 cacheR=2512188 cacheW=136607
cost total  : $3.3177
opus usage  : 0 calls (F18 zero-Opus policy maintained)

by model:
  claude-sonnet-4-6          15x  $3.3177
  n/a                         5x  $0.0000

by role:
  programmer        5x  $2.6231
  architect         5x  $0.5041
  director          5x  $0.1905
  tester            5x  $0.0000

top projects (5 of 5):
  202604221242-b13689                              $0.7866
  ...
```

### Opus 監視

`claude-opus-*` の呼び出しが 1 件でもあれば行が黄色でハイライトされる（F18 ポリシー）。

---

## `uaf clean`

古い workspace とスナップショットを削除。

### 使い方

```bash
uaf clean [--older-than <duration>] [--dry-run] [-y]
```

### オプション

| フラグ | デフォルト | 説明 |
|---|---|---|
| `--older-than <dur>` | `30d` | `7d` / `2w` / `1M` / `12h` などを受け付ける |
| `--dry-run` | false | 削除対象を表示するだけ |
| `-y` / `--yes` | false | 確認プロンプトをスキップ |

### スコープ

- `workspace/<proj-id>/` — state.json の `lastRunAt`（なければ mtime）
- `workspace/.snapshots/<proj-id>-<ts>/` — ディレクトリ mtime

両方の合算で削除対象を列挙し、確認後に `rm -rf`。

---

## `uaf config`

設定の読み書き。

### サブコマンド

| 呼び方 | 説明 |
|---|---|
| `uaf config get <key>` | 指定キーの effective 値を表示 |
| `uaf config set <key> <value>` | 指定キーに値を書き込み（デフォルト: global） |
| `uaf config list [--json]` | マージ後の effective 設定を表示 |
| `uaf config edit` | `$EDITOR` で設定ファイルを開く |

### スコープフラグ

- `--global` — `~/.uaf/config.yaml` に対して操作（デフォルト）
- `--project` — `./.uafrc` に対して操作

### 既知のキー (`KNOWN_CONFIG_KEYS`)

```
budget_usd
max_iterations
max_rounds
workspace_location
editor
models.director
models.architect
models.programmer
models.tester
models.reviewer
models.evaluator
classifier.default_type
```

未知のキーは `CONFIG_INVALID` (exit 4) で即死。

### マージ優先順位

```
project (./.uafrc)  >  global (~/.uaf/config.yaml)  >  built-in defaults
```

### 例

```bash
uaf config set budget_usd 1.5              # ~/.uaf/config.yaml
uaf config set workspace_location ~/uaf-ws --global
uaf config set models.programmer claude-sonnet-4-6 --project
uaf config list                             # 確認
uaf config get budget_usd
```

---

## `uaf doctor`

環境チェック。

### 使い方

```bash
uaf doctor [--json]
```

### チェック項目

1. **node >= 20**
2. **pnpm** が PATH にあるか
3. **playwright** が pnpm から起動可能か
4. **ANTHROPIC_API_KEY** が設定されているか
5. **config loads** — `~/.uaf/config.yaml` と `./.uafrc` が壊れていないか
6. **workspace writable** — 書き込み可能か
7. **recipes (F19 check)** — 全レシピが構造検証を通るか
8. **.env.example present** — repo root から起動しているか

### 終了コード

1 つでも FAIL があれば `DOCTOR_CHECKS_FAILED` → exit 6。

---

## 対話モードのフロー

引数なしで `uaf` を実行すると、以下のトップレベルメニューが表示される:

```
? どの操作を行いますか?
  > プロジェクトを生成する (create)
    レシピを追加する (add-recipe)
    プロジェクト一覧を表示 (list)
    レシピ一覧を表示 (recipes)
    累計コストを表示 (cost)
    環境チェック (doctor)
    終了
```

選択後、コマンドごとの小ウィザードに分岐する。**`open` / `clean` / `config` はキーワード引数前提のため、トップメニューには含まれず直接呼び出す**設計。

### ウィザードからの中断

Ctrl-C はすべて `USER_ABORT` (exit 8) にマップされる。スタックトレースは出ない（短文エラーのみ）。

---

## 参照

- CLI 実装: [`cli/README.md`](../cli/README.md)
- 設定仕様: [`cli/config/README.md`](../cli/config/README.md)
- レシピ追加: [`docs/RECIPES.md`](./RECIPES.md)
- Phase 7 原典: [`docs/spec-phase7.md`](./spec-phase7.md)
