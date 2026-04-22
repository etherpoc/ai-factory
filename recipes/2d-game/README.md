# recipes/2d-game/ — Phaser 3 ブラウザゲーム

## 概要

2D のブラウザゲームを生成するレシピ。スタックは **Phaser 3 + TypeScript + Vite**。Scene パターンで構成し、Playwright E2E で起動・操作・終了をヘッドレス検証する。

## 適用されるリクエスト例

- 「2D の避けゲームを作って」
- 「シューティングゲームを作って」
- 「落ち物パズルを作って」

(classifier が「ゲーム」「avoid」「shooter」等のキーワードで検出)

## スタック

| 項目           | 値                             |
| -------------- | ------------------------------ |
| 言語           | TypeScript (ES2022)            |
| フレームワーク | Phaser 3                       |
| バンドラ       | Vite                           |
| E2E テスト     | Playwright (Chromium headless) |
| 物理           | arcade physics（推奨）         |

## ディレクトリ構造（scaffold 直後）

```
workspace/<id>/
├── package.json
├── vite.config.ts
├── tsconfig.json
├── playwright.config.ts
├── index.html
├── public/            # アセット置き場（空）
├── src/
│   ├── main.ts        # Phaser.Game を構成
│   └── scenes/
│       └── MainScene.ts   # 例: タイトル→メイン→ゲームオーバ の雛形
└── tests/
    └── e2e/
        └── smoke.spec.ts  # 起動スペック
```

## ビルド / テスト

`recipe.yaml` 記載のコマンド:

- **build**: `pnpm install --prefer-offline && pnpm build`（timeout 300s）
- **test**: `pnpm exec playwright install --with-deps chromium && pnpm exec playwright test --reporter=line`（timeout 600s）

初回はブラウザのダウンロードが走るため時間がかかる。

## 評価基準

| id           | 必須 | 判定                               |
| ------------ | ---- | ---------------------------------- |
| builds       | ✓    | vite build が 0 で終了             |
| tests-pass   | ✓    | Playwright スイート全通過          |
| canvas-boots | ✓    | 起動スペックで canvas が描画される |

## エージェントへの追加指示

- **programmer**: Scene パターン厳守、物理は arcade、アセットは `public/` 経由
- **tester**: 3 シナリオ（起動 / 操作 / 終了）を Playwright で必ずカバー

## 変更履歴

- 2026-04-21 (Phase 3): 初版。Phaser 3 + Vite + Playwright のミニマル雛形と recipe.yaml。
