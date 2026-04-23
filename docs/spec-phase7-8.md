# Claude Code 実装指示書: Phase 7.8 (Spec-Roadmap-Resume-Preview)

## 前提

この指示書は **Phase 11.a 完了後、使用期間開始前**の段階で追加される機能強化フェーズである。

**前提条件**:
- Phase 0〜7 および Phase 11.a が完了している
- 累計テスト 376 件グリーン
- `uaf` CLI 10 コマンドが動作
- 7 レシピすべてが orchestrator 経由で動作確認済み
- Creative エージェント (artist / sound / writer / critic) が実機で動作
- F18 ポリシー（Opus ゼロ）維持
- Git 管理下、`.env` / `.claude/` は gitignored

**参照ドキュメント**（プロジェクトルートに配置済み）:
- `PROJECT_STATUS_REPORT.md` — Phase 11.a 完了時点の全体状況
- `CLAUDE_CODE_PROMPT.md` — Phase 0〜7 の原典
- `CLAUDE_CODE_PROMPT_PHASE7.md` — Phase 7 の原典
- `CLAUDE_CODE_PROMPT_PHASE11A.md` — Phase 11.a の原典
- `FINDINGS.md` — F1〜F20 の発見事項ログ
- `USAGE_DIARY.md` — 使用期間用の日記（未記入）

**最初にやること（必須）**:
1. `PROJECT_STATUS_REPORT.md` を読んで現状を完全に把握する
2. `pnpm test` で 376 件グリーンを確認
3. `uaf doctor` で環境健全性を確認

---

## ミッション

使用期間に入る前に、**実使用で必ず問題になる4つの弱点**を解消する。

1. **仕様の曖昧さ問題**: 「こういうゲームを作って」だけでは意図が伝わらない
2. **進捗不透明性**: 実行中に今何をしているか、全体のどこまで進んだか分からない
3. **中断への脆さ**: 25分の生成中に Ctrl+C / PC 再起動 / API エラーで止まると最初からやり直し
4. **プレビューの面倒さ**: 生成物を確認するために手動で pnpm install / build / preview する必要がある

これらは独立した問題ではなく、**仕様 → ロードマップ → 進捗 → プレビュー** という一連の開発フローで連鎖する。統合的に設計する。

---

## 設計原則（R1〜R9 に加えて）

### R10. 仕様ファースト原則

`uaf create <request>` は、まず **仕様書（spec.md）** を対話で作り、ユーザーが確認してから実装に移る。曖昧な自然言語を機械が推定するのではなく、人間が合意した仕様書を基に作る。

### R11. ロードマップ駆動原則

仕様書から**実装ロードマップ（roadmap.md）** を自動生成し、タスクを順序付きで記述する。orchestrator はロードマップのタスクを順に消化し、各タスク完了時に state.json に記録する。

### R12. 常時再開可能原則

すべての処理は**いつ中断されても再開可能**でなければならない。state.json は各タスク完了時に atomic write で更新し、crash / Ctrl+C / API エラーの全てに耐える。

### R13. プレビュー即時原則

生成物は `uaf preview <proj-id>` 一発でユーザーが確認できる状態にする。手動の pnpm install / build を挟まない。

---

## アーキテクチャ変更

### 新規コマンド・改修コマンド

```
# 新規
uaf resume <proj-id>            # 中断したプロジェクトを再開
uaf preview <proj-id>            # 生成物をプレビュー（ブラウザ/実行）
uaf status <proj-id>             # 現在の進捗詳細を表示
uaf spec <proj-id>               # 仕様書を表示/再編集

# 改修
uaf create                       # 対話で仕様書作成フェーズを追加
uaf list                         # 進捗情報を表示（何%完了、中断中等）
```

### 実行フローの変更（create）

```
OLD: uaf create "リクエスト"
  → Classifier → Director → ... → 完成

NEW: uaf create "リクエスト"
  → Classifier
  → [Spec Phase] 対話で仕様書作成 → spec.md
  → [Roadmap Phase] 仕様書から実装計画作成 → roadmap.md
  → ユーザー確認ステップ
  → [Build Phase] ロードマップに沿って実装（各タスクで state.json 更新）
  → [Preview Phase] uaf preview で確認可能状態に
```

### state.json スキーマの拡張

既存の state.json に以下を追加:

```json
{
  "projectId": "...",
  "recipeType": "2d-game",
  "phase": "spec" | "roadmap" | "build" | "complete" | "failed",
  "spec": {
    "path": "spec.md",
    "createdAt": "...",
    "dialogTurns": 5,
    "userApproved": true
  },
  "roadmap": {
    "path": "roadmap.md",
    "totalTasks": 12,
    "completedTasks": 7,
    "currentTaskId": "task-008",
    "tasks": [
      {
        "id": "task-001",
        "title": "Phaser Scene の骨格を作る",
        "status": "completed" | "in-progress" | "pending" | "failed",
        "startedAt": "...",
        "completedAt": "...",
        "costUsd": 0.23,
        "checkpointPath": ".checkpoints/task-001/"
      }
    ]
  },
  "iterations": [...],  // 既存
  "assets": {...},      // 既存
  "resumable": true,
  "lastCheckpointAt": "2026-04-23T12:34:56Z"
}
```

### ディレクトリ構造の追加

```
universal-agent-factory/
├── core/
│   ├── spec-builder.ts         # 新規: 対話で仕様書を作る
│   ├── roadmap-builder.ts      # 新規: 仕様書からロードマップ生成
│   ├── checkpoint.ts           # 新規: 各タスクで状態を保存
│   └── resume.ts               # 新規: 中断からの再開ロジック
├── agents/
│   └── interviewer/            # 新規エージェント: 仕様を聞き出す
│       ├── prompt.md
│       ├── index.ts
│       └── README.md
├── cli/
│   ├── commands/
│   │   ├── create.ts           # 改修: spec/roadmap フェーズ追加
│   │   ├── resume.ts           # 新規
│   │   ├── preview.ts          # 新規
│   │   ├── status.ts           # 新規
│   │   ├── spec.ts             # 新規
│   │   └── list.ts             # 改修: 進捗表示
│   └── interactive/
│       └── spec-wizard.ts      # 新規: 仕様書作成の対話 UI
└── tests/
    ├── core/
    │   ├── checkpoint.test.ts
    │   ├── resume.test.ts
    │   ├── spec-builder.test.ts
    │   └── roadmap-builder.test.ts
    └── cli/
        └── commands/
            ├── resume.test.ts
            ├── preview.test.ts
            └── status.test.ts
```

---

## 機能1: 対話形式の仕様書作成

### Interviewer エージェント

新規エージェント `interviewer` を追加。Classifier と Director の間で動作し、**ユーザーと対話して仕様を固める**役割。

**責務**:
1. ユーザーのリクエストを受け取り、曖昧な点を特定
2. 対話的に質問して仕様を詳細化
3. 最終的な仕様書（spec.md）をユーザー承認付きで作成

**モデル**: Sonnet 4.6（対話品質が重要なので Haiku ではない）

**使用ツール**:
- `ask_user` — ユーザーに質問して回答を得る（新規ツール、後述）
- `write_file` — spec.md を書き出す

### 対話の流れ

```
User: uaf create "避けゲーを作って"

Interviewer: 避けゲームを作成しますね。いくつか確認させてください。

Q1. 視点はどれが良いですか?
  1. トップダウン（上から見下ろす）
  2. サイドビュー（横から見る）
  3. 一人称視点

User: 2

Q2. プレイヤーは何を避けますか?
  1. 上から降ってくる障害物
  2. 横から飛んでくる弾
  3. 動き回る敵キャラ
  4. その他（入力してください）

User: 1

Q3. 操作方法はどれが良いですか?
  1. 左右キーのみ
  2. 左右 + ジャンプ
  3. 左右 + 攻撃
  4. マウス/タッチ操作

User: 1

Q4. 難易度の上昇はどうしますか?
  1. 時間経過で自動的に難しくなる
  2. スコアに応じて段階的に
  3. 固定難易度

User: 1

Q5. 勝利条件はありますか?
  1. 制限時間を生き残る
  2. 一定スコアを取る
  3. エンドレス（できるだけ長く生き残る）

User: 3

Interviewer: 以下の仕様で実装してよろしいですか?

--- spec.md プレビュー ---
# 仕様書: シンプルな避けゲー

## コンセプト
サイドビューの2D避けゲーム。上から落ちてくる障害物を
左右移動で避ける。時間経過で難易度上昇、エンドレスで
生存時間を競う。

## ゲームメカニクス
- 視点: サイドビュー
- プレイヤー: 画面下部、左右移動のみ
- 障害物: 画面上から下へランダム落下
- 難易度: 時間経過で落下速度と出現頻度が上昇
- 勝利条件: エンドレス、生存時間を記録

## UI要素
- タイトル画面（開始ボタン）
- ゲーム画面（スコア、生存時間表示）
- ゲームオーバー画面（最終スコア、リトライボタン）

## 技術要素（Programmer 向け）
- Phaser 3
- 3シーン構成（Title / Game / GameOver）
- localStorage でハイスコア保存

---

OK? [y/N/e（編集）]

User: y

✓ 仕様書を spec.md に保存しました
→ ロードマップ生成に進みます...
```

### 対話質問の設計

- **レシピ種別に応じて質問テンプレートを変える** — 2d-game と web-app では聞くべきことが違う
- **質問は3〜7個に制限** — 長すぎるとユーザーが疲れる
- **必ず選択肢を3〜4個提示 + 自由記述オプション** — 選ぶ方が楽、でも制限しすぎない
- **回答後すぐに仕様書ドラフトを表示** — ユーザーが結果をすぐ見られる
- **編集オプション** — `e` で回答を修正できる

### `ask_user` ツール

新規ツールとして、エージェントがユーザーに質問して回答を得る仕組みを追加。

```typescript
// core/tools/ask-user.ts

export interface AskUserInput {
  question: string;
  options?: string[];     // 選択肢（省略時は自由記述）
  allowCustom?: boolean;  // 選択肢があってもカスタム入力を許可するか
}

export interface AskUserOutput {
  answer: string;
  selectedIndex?: number;  // 選択肢から選ばれた場合
}

// 実装: stdin/stdout でやりとり（非対話モードでは事前定義の回答を使う）
```

### 非対話モード対応

対話できない環境（CI / スクリプト）でも動くように、`--spec-file <path>` オプションで事前定義の仕様書を渡せるようにする。

```bash
uaf create --spec-file my-spec.md --recipe 2d-game
```

この場合は interviewer フェーズをスキップして直接 roadmap 生成に進む。

---

## 機能2: ロードマップ生成と進捗可視化

### roadmap-builder

仕様書（spec.md）を入力として、実装タスクの順序付きリスト（roadmap.md）を生成する。

**責務**:
1. 仕様書を解析し、必要な実装項目を洗い出す
2. 依存関係を考慮して順序付け
3. 各タスクに見積もりコスト / 予想時間を付与
4. roadmap.md と state.json.roadmap に書き出す

**モデル**: Sonnet 4.6（タスク分解は構造的思考が必要）

### roadmap.md の形式

```markdown
# 実装ロードマップ: シンプルな避けゲー

## 概要
- 総タスク数: 12
- 推定コスト: $0.80 〜 $1.50
- 推定時間: 8〜15 分

## Phase 1: セットアップ（必須）
- [ ] task-001: プロジェクト構造のスキャフォールド
- [ ] task-002: アセット生成（画像5枚、音声3個）
- [ ] task-003: Phaser エンジン初期化

## Phase 2: コア実装
- [ ] task-004: Title シーン実装
- [ ] task-005: Game シーン骨格（プレイヤー、障害物）
- [ ] task-006: 衝突判定とゲームオーバー遷移
- [ ] task-007: GameOver シーン実装

## Phase 3: 難易度とスコア
- [ ] task-008: 時間経過による難易度上昇
- [ ] task-009: スコア計算と表示
- [ ] task-010: ハイスコア localStorage 保存

## Phase 4: 検証
- [ ] task-011: Playwright E2E テスト作成
- [ ] task-012: 最終ビルドと動作確認
```

### 進捗の可視化

実行中の進捗表示（シンプルログ方針維持、ただし構造化）:

```
$ uaf create "避けゲー"

✓ Classify: 2d-game
✓ Spec (interview): 5 Q&A, spec.md created ($0.12)
✓ Roadmap: 12 tasks planned, roadmap.md created ($0.08)

--- Build phase ---
[ 1/12] task-001: Scaffold project structure
        ✓ completed (12s, $0.03)
[ 2/12] task-002: Generate assets (5 images, 3 audio)
        ⠋ in progress (artist + sound running in parallel)
        ✓ completed (3m 22s, $0.18)
[ 3/12] task-003: Initialize Phaser engine
        ⠋ in progress
        ...
```

### `uaf status <proj-id>`

詳細な進捗確認:

```
$ uaf status proj-202604231234-abc123

Project: 避けゲー
Recipe: 2d-game
Phase: build
Started: 2026-04-23 12:34:56
Last activity: 2026-04-23 12:38:42 (3m ago)

Progress: 7/12 tasks (58%)

✓ task-001: Scaffold (12s, $0.03)
✓ task-002: Generate assets (3m 22s, $0.18)
✓ task-003: Initialize Phaser engine (8s, $0.02)
✓ task-004: Title scene (45s, $0.09)
✓ task-005: Game scene skeleton (1m 12s, $0.15)
✓ task-006: Collision & gameover (58s, $0.11)
✓ task-007: GameOver scene (32s, $0.07)
⠋ task-008: Difficulty progression (in progress, 0m 45s elapsed)
  task-009: Score display
  task-010: localStorage highscore
  task-011: Playwright E2E tests
  task-012: Final build

Cost so far: $0.65
Estimated remaining: $0.45 - $0.85
```

---

## 機能3: 中断からの再開

### checkpoint.ts

各タスク完了時に state.json を atomic write で更新する仕組み。

```typescript
// core/checkpoint.ts

export interface Checkpoint {
  taskId: string;
  status: 'completed' | 'failed';
  completedAt: string;
  costUsd: number;
  filesModified: string[];
  filesAdded: string[];
  // タスク固有のメタデータ
  metadata?: Record<string, unknown>;
}

export async function writeCheckpoint(
  workspacePath: string,
  checkpoint: Checkpoint
): Promise<void> {
  // 1. state.json を読む
  // 2. roadmap.tasks[taskId] を更新
  // 3. lastCheckpointAt を現在時刻に
  // 4. atomic write で state.json を更新（tmp に書いて rename）
}

export async function readLatestCheckpoint(
  projectId: string
): Promise<State | null> {
  // state.json を読み、resumable なら返す
}
```

### atomic write の実装

```typescript
// core/utils/atomic-write.ts

export async function atomicWrite(path: string, data: string): Promise<void> {
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmpPath, data, 'utf8');
  await fs.rename(tmpPath, path);  // atomic on same FS
}
```

### resume.ts

中断したプロジェクトを再開するロジック。

```typescript
// core/resume.ts

export async function resumeProject(
  projectId: string,
  options: ResumeOptions
): Promise<ResumeResult> {
  // 1. state.json を読む
  // 2. phase と current task を特定
  // 3. 中断した task から再開:
  //    - phase: 'spec' → 仕様書の続きから対話
  //    - phase: 'roadmap' → ロードマップ再生成
  //    - phase: 'build' → current task から実行再開
  // 4. roadmap の残りタスクを消化
  // 5. 完了
}

export async function findResumableProjects(): Promise<ResumableProject[]> {
  // workspace/ 配下で state.json.resumable === true のプロジェクトを探す
}
```

### 中断シグナルハンドラ

```typescript
// cli/index.ts の冒頭で

process.on('SIGINT', async () => {
  const currentProject = getCurrentProject();
  if (currentProject) {
    await writeCheckpoint(currentProject.workspacePath, {
      status: 'interrupted',
      interruptedAt: new Date().toISOString(),
    });
    console.log(`\n中断されました。再開するには: uaf resume ${currentProject.id}`);
    process.exit(130);  // SIGINT の標準終了コード
  }
  process.exit(0);
});
```

### `uaf resume <proj-id>`

```bash
$ uaf resume proj-202604231234-abc123

Resuming project: 避けゲー
Last activity: 12 minutes ago
Progress: 7/12 tasks (58%)
Next task: task-008 (Difficulty progression)

Continue? [Y/n] y

[ 8/12] task-008: Difficulty progression
        ⠋ in progress
        ...
```

### `uaf list --incomplete`

中断中のプロジェクト一覧:

```
$ uaf list --incomplete

ID                          Recipe     Progress    Last Activity
---                         ---        ---         ---
proj-202604221234-abc123    2d-game    7/12 (58%)  2h ago         ← resumable
proj-202604201856-def456    web-app    3/10 (30%)  3d ago         ← resumable
```

---

## 機能4: プレビュー

### `uaf preview <proj-id>`

種別に応じて適切なプレビュー方法を自動選択:

```typescript
// cli/commands/preview.ts

export async function preview(projId: string, options: PreviewOptions) {
  const workspace = await findProject(projId);
  const recipe = await loadRecipe(workspace.recipeType);
  
  // 種別ごとの動作
  switch (workspace.recipeType) {
    case '2d-game':
    case '3d-game':
    case 'web-app':
      // 1. pnpm install（キャッシュ済みならスキップ）
      // 2. pnpm build
      // 3. pnpm preview or dev server 起動
      // 4. ブラウザ自動オープン
      break;
    
    case 'cli':
      // 1. pnpm install + build
      // 2. 対話シェルで CLI コマンドを実行できる状態に
      // 3. uaf preview --run "--help" で直接実行可
      break;
    
    case 'api':
      // 1. サーバ起動
      // 2. OpenAPI 仕様があれば Swagger UI を開く
      // 3. 基本エンドポイントへの curl 例を表示
      break;
    
    case 'mobile-app':
      // 1. Expo dev server 起動
      // 2. QR コード表示（実機テスト用）
      // 3. Web 版ビルドでブラウザでもプレビュー可
      break;
    
    case 'desktop-app':
      // 1. Electron を dev モードで起動
      break;
  }
}
```

### スマートな挙動

- **`pnpm install` のキャッシュ**: 前回実行していれば node_modules をそのまま使う
- **ポートの自動選択**: 使用中のポートを避ける
- **起動失敗時のガイダンス**: エラーを見やすく表示、uaf doctor を提案
- **バックグラウンド実行オプション**: `uaf preview <id> --detach` で別プロセス化
- **停止コマンド**: `uaf preview --stop <id>` でサーバ停止

### preview の他コマンドとの連携

```bash
# 作ってすぐプレビュー
uaf create "避けゲー" && uaf preview <proj-id>

# iterate 後に再プレビュー
uaf iterate <proj-id> "難易度を下げる"
uaf preview <proj-id>  # 自動で rebuild & reload
```

---

## 実装フェーズ

### Phase 7.8.1: 基盤準備

1. `core/utils/atomic-write.ts` 実装とテスト
2. `core/checkpoint.ts` 実装とテスト
3. state.json スキーマを zod で拡張（既存 state.json との後方互換）
4. 既存の state.json を自動マイグレーションする機能
5. SIGINT ハンドラの実装

### Phase 7.8.2: 仕様書作成フェーズ

6. `core/tools/ask-user.ts` 新規ツール実装
7. `agents/interviewer/` 実装
   - prompt.md（レシピ種別ごとの質問テンプレートを持つ）
   - index.ts
   - README.md
8. `cli/interactive/spec-wizard.ts` 実装
9. spec.md の形式定義と検証
10. `--spec-file` オプションで非対話モード対応

### Phase 7.8.3: ロードマップ生成

11. `core/roadmap-builder.ts` 実装
12. roadmap.md の形式定義と検証
13. タスク依存関係の解決ロジック
14. 見積もりコスト/時間の計算

### Phase 7.8.4: 実行フロー改修

15. `cli/commands/create.ts` を spec → roadmap → build フローに改修
16. orchestrator をロードマップ駆動に改修
17. 各タスク完了時の checkpoint 書き込み
18. 進捗表示の実装（シンプルログに task番号とタイトル追加）
19. `cli/commands/status.ts` 新規実装

### Phase 7.8.5: 再開機能

20. `core/resume.ts` 実装
21. `cli/commands/resume.ts` 実装
22. `cli/commands/list.ts` を改修（--incomplete, --all オプション）
23. `uaf clean --incomplete` オプション追加

### Phase 7.8.6: プレビュー

24. `cli/commands/preview.ts` 実装
25. 種別別のプレビューハンドラ実装
26. ポート管理とプロセス管理
27. `uaf preview --stop` 実装

### Phase 7.8.7: 統合テストと E2E

28. 各機能のユニットテスト
29. 統合テスト: spec → roadmap → build → checkpoint → resume の全フロー
30. 実 LLM を使った小さな E2E:
   - `uaf create "小さなクリッカー" --recipe 2d-game`（対話 skip でテスト用 spec ファイル使用）
   - 途中で SIGINT → uaf resume で完走
   - uaf preview でブラウザ起動確認

### Phase 7.8.8: ドキュメント更新

31. docs/COMMANDS.md に新コマンド追加
32. docs/SPEC_DIALOG.md 新設（対話仕様書作成のガイド）
33. docs/RESUME.md 新設（中断・再開の仕組み）
34. README.md の Quick start に spec → build → preview の流れを反映
35. PROJECT_STATUS_REPORT.md を Phase 7.8 完了版に更新

---

## コア原則の遵守

### R1（README ファースト）

- 新規ディレクトリ（interviewer, spec-builder 等）に README.md 必須
- 既存 README（cli/, cli/commands/, core/ 等）に新機能を反映
- 変更履歴への追記

### R3（決定論的検証）

- 対話仕様書の完全性チェック（zod スキーマ）
- ロードマップの構造検証（各タスクに id/title/status が必須）
- checkpoint の整合性検証（state.json が zod を通ること）

### R4（サーキットブレーカー）

- 対話中の無限ループ防止（質問回数の上限設定）
- resume 時の既存タスクの再実行ループ検知

### R12（常時再開可能）

- すべての書き込みを atomic write 経由にする
- checkpoint の書き込みは各タスク完了時に必ず行う
- API エラー時も state.json を更新してから失敗する

### F18 ポリシー（Opus ゼロ）

- interviewer は Sonnet 4.6
- roadmap-builder は Sonnet 4.6
- opt-in warn で継続監視

---

## テスト戦略

### ユニットテスト

- atomic-write: ファイル破損を意図的に引き起こして整合性を検証
- checkpoint: 並行書き込みのレースコンディション
- resume: 各 phase (spec / roadmap / build) での再開
- spec-wizard: モック入力で対話フロー
- roadmap-builder: 様々な仕様書からのタスク分解

### 統合テスト（モック LLM）

- spec → roadmap → build の完全フロー
- 各フェーズでの中断と再開
- preview の種別別動作

### E2E テスト（実 LLM、予算 $3）

- 小さなクリッカーゲーム生成
- SIGINT で中断 → resume で完走
- preview でブラウザ起動
- iterate 後の preview reload

---

## 予算

### LLM 予算（Claude Code 実装用）

**$15 を許可**。詳細内訳:

- Phase 7.8.1（基盤準備）: $0（コード中心）
- Phase 7.8.2（仕様書作成）: $0.50（プロンプト設計）
- Phase 7.8.3（ロードマップ生成）: $0.50
- Phase 7.8.4（実行フロー改修）: $1.00
- Phase 7.8.5（再開機能）: $0.50
- Phase 7.8.6（プレビュー）: $0.50
- Phase 7.8.7（E2E 検証）: $5.00
- Phase 7.8.8（ドキュメント）: $0.00
- 予備: $7.00

50% 警告ライン: $7.50。

---

## 完了条件

1. `pnpm install && pnpm build` エラーなく通る
2. `pnpm test` 全通過（376 件 + Phase 7.8 で +50 件 = 目標 420+ 件）
3. `uaf create "簡単なリクエスト"` で対話モードが起動し、仕様書が作成される
4. 生成された spec.md と roadmap.md がユーザーに確認できる
5. 実行中に `uaf status <proj-id>` で現在の進捗が見える
6. Ctrl+C で中断でき、`uaf resume <proj-id>` で再開できる
7. `uaf preview <proj-id>` でブラウザ/実行環境が立ち上がる
8. `uaf list --incomplete` で中断中のプロジェクトが表示される
9. 既存の create / iterate / list 等が後方互換で動く
10. Opus 使用ゼロ維持（F18 ポリシー）
11. R1 に従い全 README 更新
12. state.json のマイグレーションが既存プロジェクトで正しく動く

---

## モデル使用方針

- interviewer: Sonnet 4.6（対話品質が重要）
- roadmap-builder: Sonnet 4.6（タスク分解は構造的思考）
- 既存エージェント: 変更なし
- Opus は使用禁止（opt-in warn で監視継続）

---

## 着手方法

1. このファイルを `docs/spec-phase7-8.md` として保存
2. `PROJECT_STATUS_REPORT.md` を読んで現状把握
3. `pnpm test` で既存 376 件グリーン確認
4. `uaf doctor` で環境健全性確認
5. Phase 7.8.1 から順次実装
6. 各サブフェーズ完了時に:
   - 該当 README の更新（R1）
   - 変更履歴への追記
   - 短い動作確認
7. 不明点があれば `QUESTIONS.md` に書き出して判断を仰ぐ

---

## 停止タイミング

連続進行で構わないが、以下で必ず停止して報告:

- **Phase 7.8.2 完了時**（仕様書作成フェーズの対話 UX を確認）
- **Phase 7.8.5 完了時**（再開機能の動作確認）
- **Phase 7.8.7 完了時**（E2E 検証完了）
- **予算 50%（$7.50）超過時**
- **既存テストが失敗した時**
- **想定外の問題発覚時**

---

## 特に注意すべき点

### 1. 対話 UX の質

対話仕様書は**使用期間でもっともユーザーが触れる部分**。質問が雑だとツール全体の印象を悪くする。質問テンプレートは時間をかけて設計すること。

### 2. 後方互換性

既存の 7 レシピと 10 コマンドを壊さない。古い state.json（Phase 11.a までの形式）も読めるマイグレーション機構を入れる。

### 3. 再開時の副作用

resume 時にすでに完了した task を再実行しないこと。state.json の status を信頼する。ただし、filesystem が変更されていたら検知して警告する。

### 4. preview のポート衝突

ユーザーが既にブラウザで別のページを開いているかもしれない。ポート 3000 / 5173 / 4173 / 8080 が使用中でないかチェックし、使用中なら別ポートを自動選択。

### 5. SIGINT の扱い

Ctrl+C を押した時、現在のツール呼び出しを途中で止めない（API レスポンス待ちの場合は受け取ってから checkpoint を書く）。強制終了は SIGINT を 2 回押された場合のみ。

### 6. spec.md / roadmap.md の再編集

ユーザーが spec.md を手動編集したい場合もある。`uaf spec <proj-id> --edit` で $EDITOR で開けるようにする。編集後に roadmap を再生成するかを聞く。

### 7. 既存プロジェクトへの影響

Phase 11.a までに作った workspace も listable にする。ただし resume は不可（roadmap が存在しないため）。list に「legacy」バッジを付ける。

---

## Phase 7.8 完了後

使用期間に入る。ユーザーが実運用で:
- 仕様書対話の UX を体感
- 長時間生成での中断 / 再開を試す
- preview で生成物を即確認
- 複数プロジェクトを並行管理

これらの知見を USAGE_DIARY.md に記録し、Phase 11.b / Phase 8 への優先度判断に使う。
