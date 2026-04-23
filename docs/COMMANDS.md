# `uaf` コマンドリファレンス (Phase 7 + 11.a + 7.8)

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
- **共通フラグ**: `--verbose` / `--help` / `--log-stream`
- **`--verbose` の位置**: コマンドの前後どちらでも動作（`uaf --verbose doctor` も `uaf doctor --verbose` も同じ）。**推奨位置はコマンド後** (UNIX 慣例)
- **`--log-stream`** (Phase 7.8.10): 構造化ログ (pino) を stderr にも流す。指定しない場合、`uaf create` / `uaf resume` のログは `workspace/<proj-id>/logs/<cmd>.log` に書き出され、`uaf logs <proj-id>` で後から参照できる。非 TTY 環境 (CI・pipe 先) では自動で有効化される
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
11. [`uaf status`](#uaf-status) **(Phase 7.8)**
12. [`uaf resume`](#uaf-resume) **(Phase 7.8)**
13. [`uaf preview`](#uaf-preview) **(Phase 7.8)**
14. [`uaf logs`](#uaf-logs) **(Phase 7.8.10)**

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
| `--no-spec` **(7.8)** | flag | false | spec/roadmap フェーズをスキップして legacy 直接フローに fallback |
| `--spec-file <path>` **(7.8)** | string | なし | 事前用意した spec.md を使い対話をスキップ |
| `-y, --yes` **(7.8)** | flag | false | spec 承認プロンプトを自動承認 |
| `--asset-budget-usd <usd>` | number | `2.0` | 画像/音声生成の予算上限。`0` で artist/sound 無効化 |
| `--no-assets` | flag | false | artist + sound エージェントをスキップ |
| `--skip-critic` | flag | false | critic エージェントをスキップ |

### 例

```bash
# デフォルト: 対話で仕様書を作ってから実装（Phase 7.8 flow）
uaf create "2Dの避けゲーム"

# 事前用意の spec.md を使う（CI / スクリプト向け）
uaf create --spec-file ./my-spec.md --recipe 2d-game --yes

# 承認を自動化（対話は残すが y/N をスキップ）
uaf create "Todo アプリ" --recipe web-app --yes

# Phase 7.8 以前の直接フロー (spec dialogue なし)
uaf create "CSV 整形 CLI" --recipe cli --no-spec --budget-usd 0.50 --max-iterations 1
```

### 挙動 (Phase 7.8 default)

1. classifier または `--recipe` でレシピ種別を決定
2. `workspace/<timestamp>-<hash>/` を作成、`state.json` に `phase='spec'` を書く
3. **Spec phase**: interviewer が ask_user で 3〜7 問質問 → spec.md 生成 → y/N/e 承認
4. `phase='roadmap'` に遷移、**Roadmap phase**: roadmap-builder が spec.md から 8〜15 タスクの roadmap.md + 構造化 JSON を生成
5. `phase='build'` に遷移、Director → Architect → Scaffold → ループ (Programmer → Build → Tester → Reviewer → Evaluator)。spec.md/design.md が既にあるので director/architect の LLM 呼び出しは事実上 cache で安価に
6. 完了時、全 roadmap タスクを `completed`、`phase='complete'`、`resumable=false`
7. SIGINT があれば `phase='interrupted'`、`resumable=true`、`uaf resume <id>` で再開可能

### 挙動 (--no-spec legacy)

Phase 7.8 以前と同じ。Director → Architect → Scaffold → ループ。state.json に `phase` / `roadmap` を書かない。`uaf resume` の対象外。

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
| `--status <status>` | completed / halted / failed / in-progress / interrupted でフィルタ |
| `--incomplete` **(7.8)** | `uaf resume` 可能なプロジェクトのみ表示 |
| `--all` **(7.8)** | `--incomplete` と併用で legacy も含める（legacy は非 resumable なので実質増えない） |
| `--json` | JSON 出力 |

### 出力例 (Phase 7.8 workspace あり)

```
ID                         RECIPE     STATUS       PHASE        PROGRESS  AGE      REQUEST
202604231234-abc123        2d-game    in-progress  interrupted  3/12      5m ago   避けゲー
202604221242-b13689        desktop-app completed  legacy       1it       2h ago   シンプルなマークダウン
```

- `PHASE` 列は Phase 7.8 workspace が少なくとも 1 つあると自動で表示される
- `PROGRESS` 列は roadmap があれば `<completed>/<total>`、なければ `<N>it`（iteration 数）
- state.json が存在しない Phase 6 以前の workspace は `(unknown)` / `(no state)` / `-` で表示
- JSON 出力には `phase` / `resumable` / `legacy` / `roadmap` フィールドが含まれる（Phase 7.8 追加）

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
| `--incomplete` **(7.8)** | false | resumable プロジェクトも age に関係なく削除対象に (デフォルトは保護) |
| `--dry-run` | false | 削除対象を表示するだけ |
| `-y` / `--yes` | false | 確認プロンプトをスキップ |

### スコープ

- `workspace/<proj-id>/` — state.json の `lastRunAt`（なければ mtime）
- `workspace/.snapshots/<proj-id>-<ts>/` — ディレクトリ mtime

両方の合算で削除対象を列挙し、確認後に `rm -rf`。

**Phase 7.8 の保護ロジック**: デフォルトでは `resumable=true` のプロジェクトは `--older-than` に該当しても削除しない（再開可能な中断プロジェクトを誤って消さないため）。`--incomplete` フラグで明示的に opt-in する。削除リストでは `proj!` バッジで表示される。

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

## `uaf status`

**(Phase 7.8)** プロジェクトの進捗と状態を表示。

### 使い方

```bash
uaf status <proj-id> [--json]
```

### 出力例

```
=== uaf status — 202604231234-abc123 ===
Workspace : /workspace/202604231234-abc123/
Recipe    : 2d-game
Request   : シンプルな避けゲー
Status    : in-progress
Phase     : build
Resumable : yes
LLM cost  : $0.6821

Spec
  path: spec.md
  dialogTurns: 5
  approved: yes

Roadmap (3/12 done, est $1.50)
  ✓ task-001: Scaffold project structure
  ✓ task-002: Generate assets
  ✓ task-003: Initialize Phaser engine
  ⠋ task-004: Title scene
  · task-005: Game scene skeleton
  ...
```

Legacy workspace（phase / roadmap なし）では `(legacy — pre-Phase 7.8 workspace)` と表示される。`--json` で機械可読出力。詳細は [`RESUME.md`](./RESUME.md) 参照。

---

## `uaf resume`

**(Phase 7.8)** 中断 / halt / failed 状態のプロジェクトを再開。

### 使い方

```bash
uaf resume <proj-id> [options]
```

### オプション

| フラグ | 型 | デフォルト | 説明 |
|---|---|---|---|
| `-y, --yes` | flag | false | "続行しますか?" プロンプトをスキップ |
| `--budget-usd <usd>` | number | config の `budget_usd` | 予算上限 |
| `--max-iterations <n>` | int | config の `max_iterations` | orchestrator ループ上限 |
| `--model <id>` | string | per-role default | モデル強制 |
| `--asset-budget-usd <usd>` | number | `2.0` | アセット予算 |
| `--no-assets` / `--skip-critic` | flag | false | Phase 11.a と同じ |

### 挙動

1. state.json を読み、filesystem を survey
2. `core/resume.ts` の `planResume()` が 5 分岐から action を決定:
   - `not-resumable` → エラー終了
   - `already-complete` → "Already complete — nothing to do." 表示して終了
   - `rerun-spec` / `rerun-roadmap` / `continue-build` のいずれか
3. ユーザー承認プロンプト
4. orchestrator を `existingWorkspace` + `skipScaffold` で起動（spec.md/design.md 既存分をスキップ）
5. 完了時 state.json を `phase='complete'` / `resumable=false` に更新

### 例

```bash
uaf resume 202604231234-abc123
uaf resume 202604231234-abc123 -y --budget-usd 2.00
```

Legacy workspace、または `phase='complete'` のものは resume できない。詳細は [`RESUME.md`](./RESUME.md)。

---

## `uaf preview`

**(Phase 7.8)** 生成プロジェクトをレシピ種別に応じた方法で起動。

### 使い方

```bash
uaf preview <proj-id> [options]
uaf preview --stop <proj-id>
uaf preview --stop-all
```

### オプション

| フラグ | 型 | デフォルト | 説明 |
|---|---|---|---|
| `--detach` | flag | false | バックグラウンド起動 (pid/port を state.json に記録) |
| `--stop` | flag | false | 該当プロジェクトの preview を停止 |
| `--stop-all` | flag | false | 全プロジェクトの preview を停止 |
| `--run <args>` | string | なし | cli レシピ専用。バイナリを指定引数で実行 |
| `--no-open` | flag | false | ブラウザ自動オープンをスキップ |
| `--port <n>` | int | 種別別 | 既定ポート (5173/3000/4173/8080) を上書き |

### レシピ別挙動

| レシピ | コマンド | 既定ポート | ブラウザ |
|--------|---------|-----------|---------|
| 2d-game / 3d-game | `pnpm dev -- --port N --strictPort` (Vite) | 5173 | 自動オープン |
| web-app | `pnpm dev -- -p N` (Next.js) | 3000 | 2.5s 遅延で自動オープン |
| api | `PORT=N pnpm dev` (Hono) | 8080 | なし (curl 例表示) |
| cli | `pnpm build` → `--run` で実行 or hint 表示 | — | なし |
| mobile-app | `pnpm start` (Expo、QR コード) | — | なし (スマホで Expo Go) |
| desktop-app | `pnpm dev` (concurrently vite + tsc) | 5173 | なし |

### ポート衝突

5173/3000/4173/8080 が使用中なら上方向に空きポートを自動探索（`cli/utils/ports.ts` の `findFreePort`）。選択ポートを stdout に `port 5173 in use — using 5174 instead` と明示。

### 失敗時のガイダンス

- `pnpm install` 失敗 → `RUNTIME_FAILURE` + hint「ネットワーク確認 / `uaf doctor` / 手動 `pnpm install --prefer-offline --ignore-workspace`」
- `pnpm build` 失敗 → hint「エラーログにファイルパスが含まれている」
- 二重起動 → 既存 pid が生存している場合は新規起動を拒否

### 例

```bash
# 標準プレビュー（Ctrl+C で停止）
uaf preview 202604231234-abc123

# バックグラウンド + ブラウザ自動オープンなし
uaf preview 202604231234-abc123 --detach --no-open

# 停止
uaf preview --stop 202604231234-abc123
uaf preview --stop-all

# CLI レシピで `--help` を実行
uaf preview 202604231234-abc123 --run "--help"
```

---

## `uaf logs`

**(Phase 7.8.10)** プロジェクトのログファイル (`workspace/<proj-id>/logs/*.log`) を整形表示する。

### 使い方

```bash
uaf logs <proj-id> [options]
```

`uaf create` / `uaf resume` などの長時間コマンドは、実行時に構造化ログ (pino JSON lines) を `workspace/<proj-id>/logs/<cmd>.log` に書き出す。対話 UI の最中は stderr にログを流さないため、進捗表示とログが混ざらない。後からログを読みたいときは `uaf logs` を使う。

### 引数

| 名前 | 必須 | 説明 |
|---|---|---|
| `<proj-id>` | ✓ | プロジェクト ID（`uaf list` で確認）|

### オプション

| フラグ | 型 | デフォルト | 説明 |
|---|---|---|---|
| `--tail [N]` | int | 50（`--tail` のみ指定時） | 末尾 N 行のみ表示 |
| `--follow` | flag | false | `tail -f` 相当。500ms ポーリングで追従 |
| `--filter <pat>` | regex | なし | 正規表現 (case-insensitive) でフィルタ |
| `--raw` | flag | false | 整形せず生 JSON を出力 (jq 等への pipe 用) |
| `--cmd <name>` | string | 全ファイル | `create` / `resume` など、特定のログファイルに限定 |

### 例

```bash
# デフォルト: 全ログを整形表示
uaf logs 202604231234-abc123

# 末尾 100 行だけ
uaf logs 202604231234-abc123 --tail 100

# エラー行だけ抽出
uaf logs 202604231234-abc123 --filter 'error|halt'

# 実行中のセッションに追従
uaf logs 202604231234-abc123 --follow

# jq 用の raw 出力
uaf logs 202604231234-abc123 --raw | jq 'select(.role=="programmer")'

# resume.log だけ見たい
uaf logs 202604231234-abc123 --cmd resume
```

### ログファイルが無い場合

- プロジェクト自体が存在しない → `PROJECT_NOT_FOUND` (exit 7)、`uaf list` の案内
- プロジェクトは存在するが `logs/` が無い → 同じく `PROJECT_NOT_FOUND`、次に `uaf create`/`uaf resume` を走らせれば出力されると説明

### 既存コマンドとの関係

- `--log-stream` をグローバルに付けると、従来通り stderr にも JSON ログが流れる。`uaf logs` を使わずリアルタイムで眺めたい場合はこれ
- ログはレベル別に色付け (ERROR=赤 / WARN=黄 / INFO=緑 / DEBUG=青)
- pino のメタデータ (`pid`, `hostname`, `v`) は表示時に除去される

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
