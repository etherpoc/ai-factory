# Claude Code 実装指示書: Phase 11.a (Creative Agents)

## 前提

この指示書は `CLAUDE_CODE_PROMPT.md` → `CLAUDE_CODE_PROMPT_PHASE7.md` の **Phase 7 完了後**に適用される、クリエイティブ系エージェントを追加するための実装指示である。

**前提条件**:
- Phase 0〜7 完了（Phase 8〜10 は未着手で後回し）
- `uaf` CLI が動作（10 コマンド完備）
- 全 7 レシピが orchestrator 経由で動作確認済み
- 累計テスト 288 件グリーン
- F18 ポリシー（Opus ゼロ）維持
- `.env` に `REPLICATE_API_TOKEN` と `ELEVENLABS_API_KEY` が設定済み
- ユーザーが Replicate / ElevenCreative のアカウント・課金設定を完了済み

**前身のドキュメント**:
- `CLAUDE_CODE_PROMPT_EXT_CREATIVE.md` — 初期の Phase 4.5 構想（叩き台として参照）
- この指示書が **正式版の Phase 11.a 指示書**、前身とは以下の点で異なる:
  - Phase 7 成果物を前提にした設計
  - Phase 11.a にクリエイティブ4体を集約（運用3体は Phase 11.b に分離）
  - state.json・`uaf` CLI・UafError・Phase C 自己検証の全パターンを踏襲

---

## 注意: 本指示書はユーザーとの設計議論で確定した仕様である

Phase 11.a の仕様は、ユーザーとの議論で以下が決定されている:

- **実装範囲**: artist + sound + writer + critic の4体（運用3体は Phase 11.b に分離）
- **画像プロバイダ**: Replicate (SDXL)
- **音声プロバイダ**: ElevenCreative（ElevenAgents ではない）
- **予算**: $15（LLM 側の実装コスト、外部 API 費用は別）
- **優先度**: Phase 8〜10（ビルド・公開）より先に実装

勝手な解釈で仕様を変更せず、不明点は必ず質問すること。

---

## ミッション

既存の7体エージェント体制に、**クリエイティブ系4体エージェント**を追加する。これにより:

- 2d-game / 3d-game に実際の画像・音声アセットが自動で付く
- web-app / mobile-app / desktop-app にコピー文、OG画像、アイコンが付く
- 生成物が「仮素材」から「公開可能なレベル」に質的に飛躍する

Phase 11.a 完了時点で、ユーザーは使用期間に入り、本格的な実使用を通じて Phase 8〜10 の設計材料を得る。

---

## 新規コア原則

### R6. エージェント宣言原則

レシピは使用する全エージェントを `agents.required` と `agents.optional` で明示する。orchestrator は宣言されたエージェントのみを起動する。

```yaml
# 例: recipes/2d-game/recipe.yaml
agents:
  required: [director, architect, programmer, tester, evaluator]
  optional: [artist, sound, writer, critic]
```

### R7. 外部API抽象化原則

外部生成API（画像・音声）は必ず `core/asset-generator.ts` を経由。各エージェントが直接 API を叩かない。プロバイダ差し替えが容易であること。

### R8. アセットキャッシュ原則

生成済みアセットは `workspace/<proj>/assets/` にキャッシュ。同一プロンプトでの再生成を避ける。キャッシュキーは `hash(provider + model + prompt + params)`。

### R9. コスト上限原則

クリエイティブ系エージェントは外部 API で追加コストが発生するため、レシピまたは CLI オプションで上限設定:

- `--asset-budget-usd <amount>` CLI オプション追加
- レシピに `assets.budget.maxUsd` 設定可
- 超過時は CircuitBreaker 発動（UafError の新コード `ASSET_BUDGET_EXCEEDED` → exit 9）

---

## 追加するエージェント（4体）

| エージェント | 役割 | 主要出力 | 使用 API | LLM 役割 |
|------------|------|---------|----------|---------|
| **artist** | 画像アセット生成（スプライト、背景、アイコン、OG 画像） | PNG、SVG | Replicate (SDXL) | プロンプト設計、アセット計画 |
| **sound** | 音声アセット生成（BGM、効果音） | MP3、WAV | ElevenCreative | プロンプト設計、音計画 |
| **writer** | コピー、ストーリー、ダイアログ生成 | MD、JSON | なし（LLM のみ） | トーン&マナー設計、テキスト生成 |
| **critic** | 体験評価（面白さ、使いやすさ） | feedback.md | なし（LLM のみ） | 主観評価、改善提案 |

### 各エージェントの LLM モデル

既存の DEFAULT_MODELS_BY_ROLE を踏襲:
- artist / sound / writer: Sonnet 4.6（プロンプト設計は複雑）
- critic: Haiku 4.5（評価はシンプル）

**Opus 使用は厳禁**（F18 ポリシー維持）。opt-in warn で監視継続。

---

## アーキテクチャ変更

### 追加ディレクトリ

```
universal-agent-factory/
├── core/
│   ├── asset-generator.ts          # 新規: 外部API統合レイヤ
│   ├── asset-cache.ts              # 新規: 生成物キャッシュ
│   └── providers/                  # 新規: プロバイダ実装
│       ├── README.md
│       ├── types.ts
│       ├── image/
│       │   ├── replicate.ts
│       │   └── index.ts            # レジストリ
│       └── audio/
│           ├── elevenlabs.ts
│           └── index.ts            # レジストリ
├── agents/
│   ├── artist/                     # 新規
│   │   ├── prompt.md
│   │   ├── index.ts
│   │   └── README.md
│   ├── sound/                      # 新規
│   ├── writer/                     # 新規
│   └── critic/                     # 新規
├── cli/
│   ├── commands/
│   │   ├── doctor.ts               # 更新: asset API キーチェック追加
│   │   └── cost.ts                 # 更新: アセット生成コスト集計
│   └── config/
│       └── schema.ts               # 更新: assets 設定追加
└── tests/
    ├── agents/                     # 各エージェントのテスト
    └── core/
        ├── asset-generator.test.ts
        ├── asset-cache.test.ts
        └── providers/
            ├── replicate.test.ts   # msw / nock でモック
            └── elevenlabs.test.ts
```

### asset-generator.ts の設計

```typescript
// core/asset-generator.ts

export interface ImageSpec {
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  style?: 'pixel-art' | 'illustration' | 'photo' | 'icon' | 'ui';
  provider?: 'auto' | 'replicate';
}

export interface AudioSpec {
  kind: 'bgm' | 'sfx' | 'voice';
  prompt: string;
  durationSec: number;
  provider?: 'auto' | 'elevenlabs';
}

export interface AssetRef {
  path: string;            // workspace/<proj>/assets/xxx.png
  cached: boolean;         // キャッシュヒットか
  costUsd: number;
  provider: string;
  metadata: Record<string, unknown>;
}

export interface AssetGenerator {
  generateImage(spec: ImageSpec, workspace: Workspace): Promise<AssetRef>;
  generateAudio(spec: AudioSpec, workspace: Workspace): Promise<AssetRef>;
  estimateCost(spec: ImageSpec | AudioSpec): number;  // USD、事前見積もり
}
```

### プロバイダ抽象化

```typescript
// core/providers/types.ts

export interface ImageProvider {
  name: string;
  supports(spec: ImageSpec): boolean;
  estimateCost(spec: ImageSpec): number;
  generate(spec: ImageSpec): Promise<Buffer>;
}

export interface AudioProvider {
  name: string;
  supports(spec: AudioSpec): boolean;
  estimateCost(spec: AudioSpec): number;
  generate(spec: AudioSpec): Promise<Buffer>;
}
```

将来 OpenAI Images や Suno を追加する場合も、このインターフェースを実装するだけで済む。

### キャッシュ戦略

```typescript
// core/asset-cache.ts

export interface AssetCache {
  get(key: string): Promise<Buffer | null>;
  set(key: string, data: Buffer, metadata: CacheMetadata): Promise<void>;
  
  // キー生成は SHA-256 prefix 12 文字
  computeKey(provider: string, model: string, prompt: string, params: object): string;
}

// キャッシュは workspace/<proj>/assets/.cache/ に配置
// プロジェクトを跨いだ共有はしない（移植性のため）
```

---

## レシピスキーマの拡張

### 既存スキーマへの追加（後方互換）

既存の7レシピは変更しない。新しく `agents` と `assets` セクションを optional で追加:

```yaml
# recipes/2d-game/recipe.yaml に追加（既存は維持）

agents:
  required: [director, architect, programmer, tester, evaluator]
  optional: [artist, sound, critic]

assets:
  image:
    defaultStyle: pixel-art
    defaultProvider: replicate
    budget:
      maxUsd: 1.50
      maxCount: 20
  audio:
    defaultProvider: elevenlabs
    budget:
      maxUsd: 0.50
      maxCount: 10

evaluation:
  criteria:
    # 既存 + 追加
    - id: visuals-coherent
      description: アセットのスタイルが統一されている
      agent: critic
      required: false
    - id: audio-present
      description: 必要な効果音とBGMが揃っている
      required: false
```

### 種別ごとの initial 設定

Phase 11.a 着手時に以下の既存レシピに設定を追加:

- **2d-game**: artist(pixel-art) + sound(8bit/chiptune) + critic
- **3d-game**: artist(3D textures) + sound(ambient) + critic
- **web-app**: writer(UI copy) + artist(OG画像) + critic
- **mobile-app**: writer(UI copy) + artist(app icon) + critic
- **desktop-app**: writer(UI copy) + artist(app icon)
- **cli**: writer(README, help text) のみ
- **api**: writer(OpenAPI description) のみ

---

## 各エージェントの詳細仕様

### agents/artist/

**責務**:
1. Director の spec.md から必要なビジュアルアセットをリストアップ
2. 統一スタイルガイドの作成（color palette、art direction）
3. 各アセットのプロンプト設計（スタイルガイドを含める）
4. `asset-generator` でバッチ生成
5. `workspace/<proj>/assets/images/` に配置
6. `assets-manifest.json` を生成（Programmer が読む）

**プロンプト設計原則**:
- 統一されたスタイルガイドを最初に作り、各アセット生成プロンプトに含める
- スタイルガイドには: 色パレット、解像度、アートディレクション、参照スタイル
- 生成失敗時は異なるプロンプトで最大2回リトライ

**出力例** (`workspace/<proj>/assets-manifest.json`):
```json
{
  "style": {
    "palette": ["#1a1a2e", "#16213e", "#e94560", "#f9d784"],
    "resolution": "64x64",
    "direction": "pixel-art, retro 80s arcade"
  },
  "assets": [
    {
      "id": "player-idle",
      "path": "images/player-idle.png",
      "prompt": "pixel art 64x64, blue spaceship facing up, ...",
      "costUsd": 0.003,
      "cached": false
    }
  ],
  "totalCostUsd": 0.045
}
```

### agents/sound/

**責務**:
1. ゲーム/アプリで必要な音を列挙（BGM、UI効果音、アクション音）
2. `asset-generator` で生成
3. `workspace/<proj>/assets/audio/` に配置
4. `audio-manifest.json` を生成（Programmer が Howler 等で読む）

**プロンプト設計原則**:
- BGM: 雰囲気（tense / upbeat / chill）とテンポ、楽器編成
- SFX: 具体的な発音描写（short metallic click, 200ms）
- 音量バランス意識（BGMはSFXより-12dB 目安）

**出力例** (`workspace/<proj>/audio-manifest.json`):
```json
{
  "bgm": [
    { "id": "title", "path": "audio/title.mp3", "durationSec": 30, "loop": true, "volume": 0.5 },
    { "id": "gameplay", "path": "audio/gameplay.mp3", "durationSec": 60, "loop": true, "volume": 0.4 }
  ],
  "sfx": [
    { "id": "jump", "path": "audio/jump.wav", "durationSec": 0.5, "volume": 0.8 },
    { "id": "hit", "path": "audio/hit.wav", "durationSec": 0.3, "volume": 0.9 }
  ],
  "totalCostUsd": 0.68
}
```

### agents/writer/

**責務**:
1. UIテキスト、エラーメッセージ、ゲーム内テキスト、マーケティングコピー生成
2. トーン&マナーガイドを先に作成
3. i18n 対応のキー設計（将来の多言語化を想定）
4. `workspace/<proj>/copy.json` に出力

**出力例**:
```json
{
  "tone": "friendly, concise, slightly playful",
  "language": "ja",
  "strings": {
    "ui.button.start": "はじめる",
    "ui.button.restart": "もう一度",
    "error.network": "接続できませんでした。もう一度お試しください。",
    "game.title": "スペースエスケープ",
    "game.gameover": "またチャレンジしてみよう!"
  }
}
```

### agents/critic/

**責務**:
1. ビルド済み成果物を実際に体験し、主観的評価を返す（Tester との役割分離に注意）
2. Tester の機械的検証とは別軸の評価
3. スクリーンショット、Playwright 操作ログを総合判断

**Tester との役割分離（重要）**:
- Tester: 「動くか」を機械的に検証（既存の責務）
- Critic: 「面白いか / 使いやすいか」を体験ベースで評価（新規）
- この分離が曖昧だと両エージェントが重複した仕事をしてトークンを浪費する

**評価軸（ゲーム）**:
- 操作感（入力レスポンス、物理挙動）
- 難易度カーブ
- ビジュアル・サウンドの統一感
- 初見プレイヤーの理解しやすさ

**評価軸（アプリ）**:
- 初回オンボーディングの明確さ
- 主要タスクの完了しやすさ
- エラー時の回復しやすさ
- 視覚階層の妥当性

**出力例** (`workspace/<proj>/critique.md`):
```markdown
# Critique Report

## 総合スコア: 7/10

## 評価軸別
- 操作感: 8/10 — キー入力レスポンスが良好、移動が滑らか
- 難易度: 6/10 — 序盤の敵の出現頻度が高すぎる
- 統一感: 8/10 — ピクセルアートとチップチューンの相性は良好
- 理解しやすさ: 5/10 — 操作方法の説明画面がない

## 改善提案
1. 序盤30秒は敵の出現を半減させる
2. ゲーム開始時に操作方法のチュートリアル画面を追加
3. スコア表示のフォントサイズを大きくする
```

Director が次イテレーションで参照する。

---

## オーケストレーターの変更

### エージェント解決ロジック

```typescript
// core/orchestrator.ts の変更

function resolveAgents(recipe: Recipe, spec: ProjectSpec): AgentRole[] {
  const required = recipe.agents?.required ?? DEFAULT_REQUIRED_AGENTS;
  const optional = (recipe.agents?.optional ?? []).filter(role => {
    // specの複雑度や機能要求から、optional を起動するか判定
    return shouldUseAgent(role, spec, recipe);
  });
  return [...required, ...optional];
}

// デフォルト（後方互換）
const DEFAULT_REQUIRED_AGENTS: AgentRole[] = [
  'director', 'architect', 'programmer', 'tester', 'reviewer', 'evaluator'
];
```

### 実行順序

```
[Classifier] → [Director] → [Architect]
  ↓
[Writer] (並列可)  [Artist] (並列可)  [Sound] (並列可)
  ↓ 完了待ち
[Programmer] ← アセットマニフェスト / copy.json 参照
  ↓
[Build] → [Tester] → [Critic] → [Evaluator]
  ↓ ループ（critic フィードバックを Director が参照）
最終: [Report]
```

クリエイティブ系は並列実行で時間短縮。Programmer はアセット完成を待つ。

---

## Phase C 自己検証の拡張（F19 流）

既存の recipe-builder で確立した Phase C パターンを、新エージェントにも適用する。

### artist の Phase C

- 全アセットが `workspace/<proj>/assets/images/` に物理的に存在することを確認
- `assets-manifest.json` の entry が全てアクセス可能
- 画像が破損していないこと（Buffer として読み込める）

### sound の Phase C

- 全音声が `workspace/<proj>/assets/audio/` に物理的に存在
- `audio-manifest.json` の entry が全て存在
- durationSec が spec と一致（ffprobe 等で検証）

### writer の Phase C

- `copy.json` が valid JSON
- 必要なキーがすべて定義されている

### critic の Phase C

- critique.md が生成されている
- 総合スコアと評価軸別スコアが数値として読める

失敗時は deterministic rollback（該当アセットの削除、state.json に記録）。

---

## state.json の拡張

既存の state.json（Phase 7.5 で定義）に `assets` フィールド追加:

```json
{
  "projectId": "...",
  "recipeType": "2d-game",
  "iterations": [...],
  "assets": {
    "images": {
      "count": 8,
      "totalCostUsd": 0.024,
      "manifestPath": "assets-manifest.json"
    },
    "audio": {
      "count": 5,
      "totalCostUsd": 0.68,
      "manifestPath": "audio-manifest.json"
    },
    "copy": {
      "path": "copy.json",
      "keys": 12
    },
    "critique": {
      "path": "critique.md",
      "overallScore": 7
    }
  }
}
```

`uaf list` や `uaf cost` がこれを読んで追加情報を表示できるようにする。

---

## `uaf` CLI への統合

### `uaf doctor` の拡張

既存の 8 項目に加えて:

- `REPLICATE_API_TOKEN` の有無と軽い疎通確認（models エンドポイントを叩く）
- `ELEVENLABS_API_KEY` の有無と軽い疎通確認
- 各プロバイダの残クレジット表示（可能なら）

### `uaf cost` の拡張

既存の LLM コスト集計に加えて:

```
Cost summary (from current workspaces)
  Period: all
  Projects analyzed: 8
  
  LLM cost:
    Opus 4.7:   $0.00 (0 calls) ✓
    Sonnet 4.6: $15.20
    Haiku 4.5:  $3.40
    
  Asset generation cost:
    Replicate:   $0.50 (120 images)
    ElevenLabs:  $2.30 (45 audio clips)
    
  Total: $21.40
  
Note: This aggregates metrics.jsonl from existing workspaces only.
```

### `uaf config` の拡張

以下のキーを allowlist に追加:

- `assets.image.defaultProvider`: 'replicate' など
- `assets.audio.defaultProvider`: 'elevenlabs' など
- `assets.budget.maxUsd`: グローバル上限
- `assets.cache.enabled`: true/false

### 新 CLI オプション（全コマンド）

- `--asset-budget-usd <amount>`: このリクエストのアセット予算上限
- `--no-assets`: クリエイティブ系を全部スキップ（既存動作と同じ）

---

## 環境変数の追加

`.env.example` に追加:

```bash
# Image generation
REPLICATE_API_TOKEN=

# Audio generation (ElevenCreative, not ElevenAgents)
ELEVENLABS_API_KEY=

# Asset generation cost limits (defaults)
DEFAULT_ASSET_BUDGET_USD=2.00
```

---

## 実装フェーズ

以下の順で実装。各サブフェーズ完了時に該当 README を更新（R1）。

### Phase 11.a.1: プロバイダ基盤

1. `core/providers/types.ts` にインターフェース定義
2. `core/asset-cache.ts` 実装（ファイルベースのコンテンツアドレッシング）
3. `core/asset-generator.ts` 実装（プロバイダレジストリとルーティング）
4. `core/providers/image/replicate.ts` 実装（SDXL）
5. `core/providers/audio/elevenlabs.ts` 実装（SFX + Music API）
6. msw / nock を使ったユニットテスト
7. モックプロバイダでの統合テスト

### Phase 11.a.2: エージェント実装

8. `agents/writer/` 実装（外部API不要、最もシンプル）
9. `agents/artist/` 実装
10. `agents/sound/` 実装
11. `agents/critic/` 実装（Playwright 連携でスクショ収集）

各エージェントは:
- `prompt.md` でシステムプロンプト定義
- `index.ts` でロジック実装
- `README.md` で責務と使い方
- Phase C 自己検証を必須化

### Phase 11.a.3: レシピ拡張と統合

12. レシピスキーマに `agents` と `assets` を追加（zod スキーマ更新）
13. `recipe-loader.ts` 更新
14. `orchestrator.ts` の resolveAgents ロジック追加
15. 既存7レシピの recipe.yaml に agents/assets セクション追加（後方互換性維持）
16. 並列実行ロジックの実装（writer/artist/sound を並列で）

### Phase 11.a.4: CLI 統合

17. `cli/commands/doctor.ts` に API キーチェック追加
18. `cli/commands/cost.ts` に asset cost 集計追加
19. `cli/config/schema.ts` に assets 設定追加
20. `--asset-budget-usd` と `--no-assets` オプション追加
21. state.json スキーマ拡張

### Phase 11.a.5: E2E 検証

22. `uaf doctor` で外部 API キーと疎通が OK になること
23. 2d-game を end-to-end で生成し、実際のアセットが付くことを確認
   - `uaf create "シンプルな2Dアクション" --recipe 2d-game --budget-usd 1.50 --asset-budget-usd 2.00`
24. 生成物を手動確認:
   - assets/images/ に画像が存在
   - assets/audio/ に音声が存在
   - copy.json に日本語UI文言
   - critique.md に主観評価
   - ゲームが実際に見て聴いて遊べる
25. web-app でも同様に検証（軽量版）
   - `uaf create "メモ帳Webアプリ" --recipe web-app --budget-usd 1.00 --asset-budget-usd 0.50`

---

## テスト戦略

### ユニットテスト

- 各プロバイダは msw / nock で HTTP モック、単体テスト
- キャッシュヒット/ミスの両パス検証
- asset-generator のプロバイダ選択ロジック

### 統合テスト

- モックプロバイダを使って、エージェント → アセット生成 → Programmer 参照の全フロー
- 実 API を叩くテストは `test:integration` として分離、通常 CI ではスキップ

### E2E テスト（実 API 使用）

- `RUN_E2E_WITH_REAL_API=true` でオプトイン
- 最小予算（<$0.20）で 1 プロジェクト完全生成
- CI ではスキップ

### 回帰テスト

既存 288 件 + Phase 11.a で +50〜80 件追加を目安。最終目標: **340+ 件**。

---

## 予算

### LLM 予算（Claude Code 実装用）

**$15 を許可**。詳細内訳:

- Phase 11.a.1（プロバイダ基盤）: $1.00
- Phase 11.a.2（エージェント実装）: $3.00
- Phase 11.a.3（レシピ拡張）: $2.00
- Phase 11.a.4（CLI 統合）: $1.00
- Phase 11.a.5（E2E 検証、実 LLM 呼び出し）: $5.00
- 予備（再生成等）: $3.00

超過しそうな場合は途中で相談。50% 警告ライン $7.50。

### 外部 API 予算（別枠、ユーザー負担）

Phase 11.a の検証で想定される消費:
- Replicate: 約 $0.50（100〜200 画像 × $0.003）
- ElevenLabs: 約 $2〜5（テスト生成）

ユーザーが事前にチャージした $10+$10 = $20 の範囲内で完結予定。

---

## 完了条件

1. `pnpm install && pnpm build` エラーなく通る
2. `pnpm test` 全通過（目標 340+ 件）
3. `uaf doctor` が Replicate / ElevenLabs の API 疎通を確認できる
4. `uaf create "..." --recipe 2d-game` で、実際の画像と音声が付いたゲームが生成される
5. 生成された 2d-game が「実際に見て聴いて遊べる」レベル
6. `uaf cost` がアセット生成コストも含めて表示する
7. 既存の7レシピすべてが新スキーマを後方互換で通る
8. Opus 使用ゼロを維持（F18 ポリシー継続）
9. Critic の評価軸が Tester と明確に分離されている
10. Phase C 自己検証が全新エージェントで機能する
11. R1 に従い全 README が更新されている
12. state.json に assets 情報が記録される

---

## モデル使用方針

- artist / sound / writer: Sonnet 4.6
- critic: Haiku 4.5
- Opus 使用は厳禁（F18 ポリシー、opt-in warn で監視継続）
- Classifier は引き続きヒューリスティック実装を使用

---

## 注意事項

### 1. API 規約遵守

- Replicate / ElevenLabs には商用利用条件がある。プロバイダ実装のコメントに TOS の参照を明記
- `artist` / `sound` のシステムプロンプトで、著名キャラクター名や実在人物を模したプロンプトを生成しないよう明示
- 生成物は「派生物ではなくオリジナル」として生成する

### 2. レート制限

- 各プロバイダのレート制限を実装（`p-limit` 等）
- 429 エラー時は指数バックオフでリトライ

### 3. プライバシー

- ユーザーのリクエスト自然言語をそのまま外部プロバイダに送らない
- 抽象化したプロンプト（エージェントが再構成したもの）を送る
- `.env` の API キーは絶対にログ出力しない

### 4. キャッシュの取り扱い

- キャッシュはプロジェクト単位（workspace/<proj>/.assets-cache/）
- プロジェクト間で共有しない（移植性のため）
- `uaf clean` でプロジェクト削除時に自動削除

### 5. E2E 検証のコスト

- 最初の E2E は小さめで（避けゲーより「色の動くクリッカー」等）
- アセット予算 $0.50 程度に絞って挙動確認
- 問題なければ本番サイズの E2E（避けゲー等）に進む

### 6. Phase 11.b は別途

運用系3体（documenter / security-auditor / devops）は Phase 11.b として別指示書で扱う。Phase 11.a の完了後に、Phase 8 の必要性と比較して優先度判断する。

---

## 着手方法

1. このファイルを `docs/spec-phase11a.md` としてプロジェクト内にコピー
2. `PROJECT_STATUS_REPORT.md` を読んで現状把握
3. 外部 API キーが `.env` に存在することを確認（ユーザー確認済み）
4. Phase 11.a.1 から順次実装
5. 各サブフェーズ完了時に:
   - 該当 README の更新（R1）
   - 変更履歴への追記
   - 短い動作確認
6. Phase 11.a.5（E2E 検証）完了時に停止して報告
7. 不明点があれば `QUESTIONS.md` に書き出して判断を仰ぐ

---

## 特に注意すべき点

### 1. Critic と Tester の役割分離

最も混乱しやすい部分。Tester は「動くか」を機械的に、Critic は「面白いか」を主観的に。
プロンプトに明示的に書き、両者の出力が重複しないように設計する。

### 2. 並列実行の調整

writer/artist/sound を並列実行する際、プロバイダのレート制限に注意。
Promise.all で並列化しつつ、各プロバイダ内では `p-limit` で同時実行数制限。

### 3. アセット予算管理の粒度

- プロジェクト単位の予算（CLI オプション）
- プロバイダ単位の予算（レシピ設定）
- 全体の予算（グローバル設定）

3層の優先順位を明確にする。プロジェクト > レシピ > グローバル。

### 4. Programmer がアセットを読めるように

assets-manifest.json と audio-manifest.json の形式を Programmer のシステムプロンプトに明記。
「生成されたアセットを参照するには、このファイルを読め」という指示を Programmer のプロンプトに追加する。

### 5. 失敗時の fallback

外部 API が落ちた場合や予算超過した場合、エージェント自体をスキップして完走させるか、失敗させるかの判断が必要。
推奨: 必須ではないエージェントはスキップして警告ログ、必須エージェントは失敗させる。

### 6. 実 API 検証時の Opus 監視

Phase 11.a.5 の E2E 検証で大量の LLM 呼び出しが発生する。
metrics.jsonl と Anthropic Console の両方で Opus 使用ゼロを確認すること。
