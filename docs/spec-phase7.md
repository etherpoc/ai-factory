# Claude Code 実装指示書: Phase 7 (CLI & DX)

## 前提

この指示書は `CLAUDE_CODE_PROMPT.md` の **Phase 6 完了後**に適用される、CLI とユーザー体験（DX）を整備するための実装指示である。

**前提条件**:
- Phase 0〜6 が完了している
- 全 5 種別のレシピ（2d-game, web-app, cli, api, 3d-game, mobile-app, desktop-app）で orchestrator 経由の動作確認が済んでいる
- F19 + F20 対策が実装済み
- 累計テスト 137 件グリーン
- `PROJECT_STATUS_REPORT.md` の内容を把握している

---

## 注意: 本指示書はユーザーとの設計議論で確定した仕様の実装指示である

Phase 7 の仕様は、**人間主導の設計議論で8項目にわたり詳細に合意された内容**である。勝手な解釈で仕様を変更せず、不明点は必ずユーザーに質問すること。

特に以下は**決定済み**:
- 利用者は個人用（OSS公開・商用化は当面考えない）
- 10 コマンドすべてを実装する
- 対話モードはハイブリッド（引数あり=非対話、引数なし=ウィザード）
- 進捗表示はシンプルログ（リッチUI不要）
- エラー表示は両方（デフォルト簡潔、--verbose で詳細）
- 設定ファイルは両方マージ方式（~/.uaf/config.yaml + ./.uafrc）
- プロファイル機能は実装しない（Phase 8 以降）
- ドキュメントはフルセット（README + docs/COMMANDS.md + docs/RECIPES.md + --help）

---

## ミッション

既存の `scripts/run.ts` と `scripts/add-recipe.ts` をベースに、`uaf` コマンドとして統合された CLI を構築する。個人用プロトタイピングツールとして完成度の高い DX を提供する。

---

## コア原則の確認

Phase 7 では既存の R1〜R5 を引き続き遵守する。特に以下が重要:

### R1. README ファースト原則

Phase 7 の実装と同時に以下のドキュメントを整備する:
- ルート `README.md` — プロジェクト全体像と quick start
- `docs/COMMANDS.md` — 全コマンド詳細
- `docs/RECIPES.md` — レシピ追加ガイド
- 各コマンドの `--help` テキスト

### R5. コスト可観測性原則

`uaf cost` コマンドで既存の metrics.jsonl を集計表示するため、ロギング形式は既存を維持。

---

## 技術スタック

既存のスタックに加えて、CLI 実装用に以下を使用:

- **CLI フレームワーク**: `commander` または `yargs`（推奨: `commander`、シンプルで TypeScript 対応良好）
- **対話 UI**: `@inquirer/prompts`（`inquirer` の新バージョン、ESM 対応）
- **カラー出力**: `picocolors`（`chalk` 代替の軽量版）
- **spinner / 進捗**: 使わない（シンプルログ方針）
- **設定ファイル**: `yaml` パッケージ（既存で使用中のものを流用）
- **日付処理**: `date-fns`（`uaf clean --older-than` 等で使用）

**重要**: 重い依存は避ける。`ink` や `blessed` のようなリッチ TUI ライブラリは使わない。

---

## ディレクトリ構造（追加分）

```
universal-agent-factory/
├── cli/                            # 新規: CLI 本体
│   ├── README.md
│   ├── index.ts                    # メインエントリ
│   ├── commands/                   # 各コマンド実装
│   │   ├── create.ts
│   │   ├── add-recipe.ts
│   │   ├── iterate.ts
│   │   ├── list.ts
│   │   ├── open.ts
│   │   ├── recipes.ts
│   │   ├── cost.ts
│   │   ├── clean.ts
│   │   ├── config.ts
│   │   └── doctor.ts
│   ├── interactive/                # 対話モード実装
│   │   ├── wizard.ts               # ウィザード風対話のエントリ
│   │   └── prompts.ts              # 共通プロンプト定義
│   ├── config/                     # 設定ファイル管理
│   │   ├── loader.ts               # グローバル + プロジェクト別のマージ
│   │   ├── schema.ts               # zod スキーマ
│   │   └── defaults.ts             # 内蔵デフォルト値
│   ├── ui/                         # 出力関連
│   │   ├── logger.ts               # シンプルログ出力
│   │   ├── errors.ts               # エラー表示（簡潔/詳細切替）
│   │   └── colors.ts               # picocolors ラッパー
│   └── utils/
│       ├── workspace.ts            # workspace の特定/検索
│       ├── editor.ts               # uaf open で使うエディタ呼び出し
│       └── duration.ts             # --older-than のパース
├── docs/
│   ├── COMMANDS.md                 # 全コマンドの詳細
│   └── RECIPES.md                  # レシピ追加ガイド
├── bin/
│   └── uaf.js                      # shebang 付きエントリポイント
├── package.json                    # bin フィールドで uaf を登録
└── tests/
    └── cli/                        # CLI のテスト
        ├── commands/
        ├── config/
        └── integration/
```

---

## 実装フェーズ

以下の順で実装する。各フェーズ完了時に関連 README を更新すること（R1）。

### Phase 7.1: CLI 基盤

1. `package.json` の `bin` フィールドに `uaf` を登録
2. `bin/uaf.js` に shebang 付きエントリポイント作成
3. `cli/index.ts` に commander ベースのコマンドルーター実装
4. `cli/ui/logger.ts` と `cli/ui/colors.ts` の基本実装
5. `cli/ui/errors.ts` でデフォルト簡潔 / `--verbose` 詳細 の切替実装
6. 全コマンド共通フラグ（`--verbose`, `--help`）の実装

### Phase 7.2: 設定ファイル機構

7. `cli/config/schema.ts` で zod スキーマ定義
8. `cli/config/defaults.ts` で内蔵デフォルト値を定義
9. `cli/config/loader.ts` でグローバル（`~/.uaf/config.yaml`）とプロジェクト別（`./.uafrc`）のマージ実装
   - マージ優先順: プロジェクト > グローバル > 内蔵デフォルト
10. 設定可能項目の粒度（標準）:
    - `budget_usd`: デフォルト予算
    - `max_iterations`: イテレーション上限
    - `max_rounds`: tool-use ラウンド上限
    - `workspace_location`: workspace の保管場所
    - `models`: role別モデル（既存の DEFAULT_MODELS_BY_ROLE を上書き可）
    - `classifier`: デフォルトレシピ type の上書き
    - `editor`: `uaf open` で使うエディタ（デフォルトは `$EDITOR` 環境変数）
11. 回帰テスト追加

### Phase 7.3: コアコマンド実装（create, add-recipe）

12. `cli/commands/create.ts` を実装
    - 既存の `scripts/run.ts` の機能を移植
    - 引数: `<request>`, `--recipe`, `--budget-usd`, `--max-iterations`, `--max-rounds`, `--verbose`
    - 引数なしで起動時はウィザード風対話へ遷移
13. `cli/commands/add-recipe.ts` を実装
    - 既存の `scripts/add-recipe.ts` の機能を移植
    - 引数: `--type`, `--description`, `--reference`, `--budget-usd`, `--max-rounds`
    - 引数なしで起動時はウィザード風対話へ遷移
14. 旧 `scripts/run.ts` と `scripts/add-recipe.ts` は後方互換のため残し、内部的に CLI コマンドを呼ぶように書き換え

### Phase 7.4: 対話モード（ウィザード）

15. `cli/interactive/prompts.ts` で共通プロンプト（リクエスト入力、予算選択、確認等）を定義
16. `cli/interactive/wizard.ts` でウィザード風対話のエントリ実装
    - `uaf` だけで起動した場合のトップレベルメニュー
    - 選択に応じて各コマンドに分岐
17. 各コマンドで「引数不足時はウィザードに遷移」の挙動を統一

### Phase 7.5: 残りコマンド実装

18. `cli/commands/iterate.ts` を実装（**最も技術的に重い**）
    - 引数: `<proj-id>`, `<request>`, `--budget-usd`, `--max-iterations`
    - `workspace/<proj-id>/` を特定
    - 既存ソースコードを Programmer の context に含める
    - プロンプトに「既存コード保持 + 差分追加」の指示を追加
    - Tester / Evaluator で動作確認
    - 変更差分のレポート生成（追加ファイル、変更ファイル、削除ファイル）
    - orchestrator の内部改修が必要: 既存コードの context 取り込み機構
19. `cli/commands/list.ts` を実装
    - `workspace/` 配下を走査
    - 各 workspace の projectId、作成日時、使用レシピ、ステータス（完走/halt）を表示
    - `--recipe`, `--status` でフィルタ可
20. `cli/commands/open.ts` を実装
    - `workspace/<proj-id>/` をエディタまたはブラウザで開く
    - 種別に応じて適切なアクション（web系はブラウザ、それ以外はエディタ）
    - `--editor <editor>` で明示指定可
21. `cli/commands/recipes.ts` を実装
    - `recipes/` 配下を走査、各レシピの meta 情報を表示
    - name, description, stack, version を表示
22. `cli/commands/cost.ts` を実装
    - `workspace/` 配下の全 metrics.jsonl を集計
    - `--period <today|week|month|all>` で期間指定
    - モデル別、レシピ別、プロジェクト別の集計を表示
23. `cli/commands/clean.ts` を実装
    - `workspace/` の古いプロジェクトを削除
    - `--older-than <duration>` で期間指定（例: `7d`, `2w`, `1m`）
    - `--dry-run` で削除対象の表示のみ
    - 削除前に確認プロンプト（`--yes` でスキップ可）
24. `cli/commands/config.ts` を実装
    - `uaf config get <key>` — 値の取得
    - `uaf config set <key> <value>` — 値の設定
    - `uaf config list` — 全設定の表示
    - `uaf config edit` — `$EDITOR` で設定ファイルを開く
    - `--global` / `--project` でターゲット切替
25. `cli/commands/doctor.ts` を実装
    - `ANTHROPIC_API_KEY` の有無と有効性（軽い疎通確認）
    - Node.js / pnpm のバージョン確認
    - Playwright / Chromium の存在確認
    - 各レシピの構造検証（既存の `scripts/check-recipes.ts` を呼ぶ）
    - `workspace/` の書き込み権限確認
    - 設定ファイルの妥当性確認
    - 問題が見つかった場合は具体的な修正手順を提示

### Phase 7.6: ドキュメント整備

26. ルート `README.md` を Phase 7 版に大幅書き換え
    - プロジェクト全体像
    - Quick start（インストールから最初のゲーム生成まで）
    - 各コマンドの簡潔な使用例
    - 参照リンク（COMMANDS.md, RECIPES.md）
27. `docs/COMMANDS.md` を新規作成
    - 全 10 コマンドの詳細
    - 引数、オプション、使用例、サンプル出力
28. `docs/RECIPES.md` を新規作成
    - 既存レシピ一覧と概要
    - `uaf add-recipe` による追加方法
    - レシピスキーマの解説
    - 手動でレシピを追加する方法（recipe-builder を使わない場合）
29. 各コマンドの `--help` テキストを充実

### Phase 7.7: 統合テストと最終確認

30. 各コマンドのユニットテスト追加
31. 対話モードの統合テスト（モック入力）
32. エンドツーエンド動作確認
    - `uaf doctor` で環境OK
    - `uaf recipes` で7種別が表示される
    - `uaf create "テスト用の小さなクリックゲー" --recipe 2d-game --budget-usd 0.30 --max-iterations 1` で完走
    - `uaf list` で生成したプロジェクトが表示される
    - `uaf cost --period today` で本日のコストが表示される
    - `uaf iterate <proj-id> "背景色を青にして" --budget-usd 0.20` で差分追加が機能する
    - `uaf clean --older-than 1d --dry-run` で削除対象の表示確認

---

## iterate コマンドの詳細設計

**これが Phase 7 で最も技術的に重い項目**なので、設計を明確化する。

### 動作フロー

```
uaf iterate <proj-id> "敵キャラをもう1種類追加して"
  → workspace/<proj-id>/ を特定
  → 既存 state.json から使用レシピと作成日時を読み込み
  → 既存のソースコードを listdir + read で context に取り込み
  → orchestrator を「iterate モード」で起動
     - classifier はスキップ（既存のレシピを使う）
     - Director には「既存プロジェクトへの差分追加リクエスト」として依頼
     - Programmer には「既存コードを保持しながら差分追加」のシステムプロンプトを追加
     - Tester は既存のテストも新規テストも実行
     - Evaluator は「差分追加後も既存機能が壊れていないこと」を評価基準に追加
  → 変更差分のレポート生成
     - 追加ファイル一覧
     - 変更ファイル一覧（diff summary）
     - 削除ファイル一覧
     - 新規追加テストと結果
```

### orchestrator 改修点

新規関数 `runIterate(projectId, request, options)` を追加:

```typescript
export async function runIterate(
  projectId: string,
  request: string,
  options: IterateOptions
): Promise<IterateResult> {
  const workspace = await loadExistingWorkspace(projectId);
  const recipe = await loadRecipe(workspace.recipeType);
  
  // 既存コードのスナップショット
  const before = await snapshotWorkspace(workspace.path);
  
  // iterate 用のコンテキストを構築
  const context = {
    mode: 'iterate',
    existingSnapshot: before,
    originalRequest: workspace.originalRequest,
    iterateRequest: request,
  };
  
  // 通常の orchestrator ループを iterate モードで走らせる
  const result = await runLoop(workspace, recipe, context, options);
  
  // 差分レポート生成
  const after = await snapshotWorkspace(workspace.path);
  const diff = generateDiff(before, after);
  
  return { result, diff };
}
```

### 既存コードの取り込み戦略

- **全ファイル取り込み**はコンテキスト肥大化のリスクあり
- **方針**: `src/` 配下の TS/JS/CSS ファイルのみ、合計 50,000 tokens を超えたら警告
- 取り込み優先順: エントリポイント > 主要な実装 > テスト > 設定ファイル
- `node_modules/`, `dist/`, `.git/` 等は除外

### システムプロンプト強化

Programmer の iterate モード用プロンプトに以下を追加:

```
# Iterate Mode

You are modifying an existing project. Rules:

1. Preserve existing functionality: Do not break current features
2. Minimal changes: Only modify files necessary for the requested change
3. No refactoring without reason: If the user didn't ask to refactor, don't
4. Update tests: Add tests for new behavior, ensure existing tests pass
5. Explicit diff summary: In your final response, list:
   - Files added
   - Files modified (with brief description of change)
   - Files deleted (should be rare)
```

---

## 設定ファイルのスキーマ例

```yaml
# ~/.uaf/config.yaml または ./.uafrc

# デフォルト予算（USD）
budget_usd: 1.00

# イテレーション上限
max_iterations: 3

# tool-use ラウンド上限
max_rounds: 30

# workspace の保管場所（省略時は ./workspace）
workspace_location: ~/Documents/uaf-workspace

# role別モデル（省略時は内蔵デフォルト）
models:
  director: claude-sonnet-4-6
  architect: claude-sonnet-4-6
  programmer: claude-sonnet-4-6
  tester: claude-haiku-4-5
  reviewer: claude-haiku-4-5
  evaluator: claude-haiku-4-5

# uaf open で使うエディタ（省略時は $EDITOR）
editor: code

# uaf create の対話モードでスキップする質問（省略時は全て質問）
skip_prompts:
  - budget  # 予算は常にデフォルト値を使う
```

---

## エラー表示の実装例

### デフォルト（簡潔）

```
✗ 生成に失敗しました

  原因: 自己検証が完了しませんでした（Phase C 未到達）
  対処: ラウンド上限を増やして再試行してください

    uaf create "..." --max-rounds 60

  詳細: workspace/proj-xxx/metrics.jsonl
  詳細表示: --verbose で再実行
```

### --verbose（詳細）

```
✗ 生成に失敗しました: Phase C validation failed

  エラー種別: VALIDATION_ERROR
  コード: PHASE_C_EVIDENCE_MISSING
  
  詳細:
    bash_log に存在した証跡: ["pnpm install completed", "tsc --noEmit completed"]
    不足している証跡: test execution evidence
    
  実行情報:
    recipe: desktop-app
    max_rounds: 45
    rounds used: 45
    tool calls: 68
    
  実施した操作: rollback (recipes/.tmp/desktop-app-xxx removed)
  
  提案:
    - --max-rounds 60 で再試行
    - 必要なら --reference web-app を指定して骨格を参考にさせる
  
  完全ログ: workspace/proj-xxx/metrics.jsonl
  recipe-builder ログ: recipes/.tmp/desktop-app-xxx/BUILD.log
```

---

## コーディング規約

- 既存のルール（any 禁止、エラーハンドリング、ロギング等）を踏襲
- 新規ファイルは関数単位で単一責任
- `cli/` 配下は `core/`, `agents/`, `meta/` を参照してよい（逆は禁止）
- CLI パーサーのテストは必ず追加

---

## 完了条件

1. `pnpm install && pnpm build` がエラーなく通る
2. `pnpm test` が全通過（既存 137 + 新規 30 以上 = 合計 170 以上を目安）
3. `npm link` または `pnpm link --global` した状態で `uaf` コマンドが使える
4. 10 コマンドすべてが動作する（各コマンドの `--help` でヘルプが表示される）
5. 対話モード（引数なし）と非対話モード（引数あり）の両方が機能する
6. 設定ファイル（グローバル + プロジェクト別）のマージが正しく動く
7. iterate が既存プロジェクトを壊さず差分追加できる
8. `uaf doctor` で環境問題を検出できる
9. `uaf cost` で累計コストが表示される
10. Opus 使用ゼロを維持（metrics.jsonl で確認）
11. ドキュメント（README、COMMANDS.md、RECIPES.md）が整備されている
12. R1 原則に従い、各ディレクトリの README が更新されている

---

## 実装予算

**$7 を許可**。詳細内訳:

- Phase 7.1〜7.2（基盤 + 設定）: $0.50
- Phase 7.3（コアコマンド移植）: $1.00
- Phase 7.4（対話モード）: $1.50
- Phase 7.5（残りコマンド、特に iterate）: $2.50
- Phase 7.6（ドキュメント）: $0.50
- Phase 7.7（統合テスト + 動作確認）: $1.00
- 予備: $0.00（余裕含む）

超過しそうな場合は途中で相談してください。

---

## モデル使用方針

- 既存の DEFAULT_MODELS_BY_ROLE を踏襲
- Phase 7 の実装自体では LLM を呼ばない（CLI は主にコード書き）
- iterate のテストで少量の LLM 呼び出しが発生
- Opus は使用禁止（opt-in warn で監視継続）

---

## 着手方法

1. このファイルを `docs/spec-phase7.md` として保存
2. `PROJECT_STATUS_REPORT.md` を読んで現状を把握
3. Phase 7.1 から順次実装
4. 各サブフェーズ完了時に:
   - 該当 README の更新（R1）
   - 変更履歴への追記
   - 短い動作確認
5. 不明点があれば `QUESTIONS.md` に書き出してから判断を仰ぐ

---

## 特に注意すべき点

### 1. 機能追加より体験の洗練

Phase 7 は「何を作るか」より「どう使えるか」が重要。リッチな機能追加より、**一貫性のある挙動と分かりやすいエラーメッセージ**を優先すること。

### 2. iterate は慎重に設計

iterate は既存プロジェクトを壊す可能性があるので、**破壊的変更に対する安全装置**を複数用意すること:
- 実行前に workspace を git commit / tar でスナップショット
- 失敗時の rollback 機構
- `--dry-run` オプション
- 変更差分の事前プレビュー（`--preview` オプションも検討）

### 3. ドキュメントは個人用でも手抜かない

「3ヶ月後の自分」が使えるレベルで書くこと。自分しか使わないとはいえ、未来の自分は他人である。

### 4. 既存の scripts/run.ts の扱い

後方互換のため削除しない。内部的に CLI コマンドを呼ぶように書き換え、`scripts/run.ts --request "..." --recipe 2d-game` が従来通り動くようにする。

### 5. グローバルインストール対応

`pnpm link --global` で `uaf` コマンドがどこからでも使えるように設計する。ただし workspace パスは絶対パスで扱い、カレントディレクトリ依存の挙動は避ける。
