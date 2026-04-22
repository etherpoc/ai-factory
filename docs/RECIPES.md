# レシピ追加ガイド

UAF の **レシピ** は `recipes/<type>/` 配下の雛形 + 評価基準 + ビルド/テストコマンドのセット。新しいプロジェクト種別はレシピ追加だけで対応でき、`core/` や `agents/` は変更不要（R2 原則）。

## 既存レシピ

| type | stack | 用途 |
|---|---|---|
| `2d-game` | Phaser 3 + Vite | 2D ブラウザゲーム |
| `3d-game` | Three.js + Vite | 3D ブラウザゲーム |
| `web-app` | Next.js 14 + Tailwind | モダン Web アプリ |
| `mobile-app` | Expo (React Native) + Jest | Android / iOS 共通モバイル |
| `desktop-app` | Electron + Vite | macOS / Windows / Linux デスクトップ |
| `cli` | Node.js + commander + vitest | コマンドラインツール |
| `api` | Hono + vitest | REST API サーバー |

`uaf recipes` で常に最新の一覧と description を確認できる。

## レシピの追加方法

### A. 推奨: メタエージェント経由

```bash
uaf add-recipe --type 3d-game-vr --description "WebXR 対応 3D ゲーム" --reference 3d-game
```

内部動作（Phase 5 で実装済み、F19 で Phase C を必須化）:

1. **Phase A (リサーチ)**: bash / list_dir / read_file で既存レシピを読み、構造を学習
2. **Phase B (書き込み)**: `recipes/.tmp/<type>-<ts>/` に template を clone し、種別に合わせて書き換え
3. **Phase C (自己検証)**: tmp 内で `pnpm install` → `tsc --noEmit` → build → test を実行
4. **validateBuiltRecipe**: Phase C の bash ログを解析し、install / build / test の証跡を検証
5. 成功時のみ `recipes/<type>/` に atomic rename、失敗時は tmp を rollback

**--reference の使い方**: 構造的に近い既存レシピを指定すると、recipe-builder が最初に `cat recipes/<reference>/recipe.yaml` などを読んでから書き始める。scope が近いレシピほど成功率が上がる。

**成功条件**:
- kebab-case の type 名（`a-z`, `0-9`, `-` のみ、両端は英数）
- 予約名 `_template` / `.tmp` は使えない
- Phase C の install + build + test すべて成功

**失敗時**: `RECIPE_BUILD_FAILED` (exit 5) で終了。tmp ディレクトリは自動削除される（F19 の atomic rollback）。

### B. 手動追加

`recipes/_template/` をコピーして編集。

```bash
cp -r recipes/_template recipes/<type>
```

必要なファイル:

```
recipes/<type>/
├── README.md                 # このレシピの目的・制約
├── recipe.yaml               # メタ情報 + build/test コマンド + 評価基準
├── prompts/
│   ├── programmer.md         # promptAppend (default + recipe-specific 指示)
│   └── tester.md             # 同上
└── template/                 # scaffold のテンプレート (cp -r で workspace に展開される)
    ├── package.json          # 必須
    ├── README.md             # 必須
    ├── src/
    ├── tests/
    └── ...
```

追加後のチェック:

```bash
pnpm tsx scripts/check-recipes.ts    # F19 構造検証
pnpm test                             # 既存テスト回帰
```

手動追加の場合でも `tests/recipes/<type>.test.ts` を作るのを推奨（recipe loader が正しく読める / template が完全であることを保証）。

## recipe.yaml スキーマ

```yaml
meta:
  type: 2d-game
  version: 1.0.0
  description: Phaser 3 + TypeScript + Vite による 2D ブラウザゲーム

stack:
  language: typescript
  framework: phaser3
  deps: [phaser, vite]

scaffold:
  type: template                 # or "generator" (command 実行で生成)
  path: template                 # template ディレクトリの相対パス

build:
  command: pnpm build
  timeoutSec: 180

test:
  command: pnpm test
  timeoutSec: 240

evaluation:
  criteria:
    - id: builds
      description: pnpm build が成功する
      required: true
    - id: tests-pass
      description: Playwright E2E が pass する
      required: true
    - id: canvas-boots
      description: ゲーム canvas が表示される
      required: true
  entrypoints:
    - src/main.ts
    - src/scenes/MainScene.ts

agentOverrides:
  programmer:
    promptAppend: |
      Phaser 3 を使い、src/scenes/ にシーンを分けて実装してください。
    additionalTools: []
    # model: claude-opus-4-7   # opt-in only; 通常は空
```

### 必須項目

- `meta.type` がディレクトリ名と一致すること
- `stack.language` / `stack.framework` / `stack.deps`
- `scaffold.type` = `template` または `generator`
- `build.command` / `test.command` / それぞれの `timeoutSec`
- `evaluation.criteria` が 1 件以上
- 必要なら `entrypoints` を挙げて `empty scaffold` 検出に寄与させる

### agentOverrides

ロール別の promptAppend を追加する。recipe に固有の指示（"Phaser は Scene 単位" 等）はここに。

- **`model` の上書きは opt-in**。通常は空。Opus 4.7 を指定すると `resolveModel` が opt-in warn を発火する (F18)。

## 評価基準 (criteria) の設計

- `required: true` を 1 つ以上持つこと（全部 false だと空 scaffold が 100 点取る）
- `id` は `builds` / `tests-pass` / `responsive` / `canvas-boots` のような短いラベル
- 評価は orchestrator の `defaultEvaluate` がビルド結果 / テストレポート / entrypoints のファイル差分から行う（deterministic）
- LLM の自己申告だけで合格にしない (R3)

## よくある落とし穴

- **template に `node_modules` を入れない** — scaffold が重くなる、.gitignore で除外
- **`package.json` を入れ忘れない** — F7 空 scaffold ガードに引っかかる
- **`timeoutSec` を短くしすぎない** — mobile-app の expo install は 180s では足りないケースがある
- **`entrypoints` を定義しよう** — scaffold コピーと実装の差分検知に使われる。空 scaffold の評価器バイパスを防ぐ

## 関連

- Phase 5 メタエージェント: [`meta/README.md`](../meta/README.md)
- F19 Phase C 必須化: [`FINDINGS.md`](../FINDINGS.md)
- 構造検証スクリプト: [`scripts/check-recipes.ts`](../scripts/check-recipes.ts)
