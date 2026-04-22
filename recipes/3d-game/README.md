# Recipe: 3d-game

Three.js + Vite + Playwright による 3D ブラウザゲームを生成するレシピです。
Phaser の代わりに Three.js を使い、WebGLRenderer で直接 Scene / Camera / Mesh を管理します。

## 適用されるリクエスト例

1. 「Three.js でキューブを操作する 3D アクションゲームを作って」
2. 「WebGL ベースの 3D シューティングゲーム（弾を撃って敵を倒す）」
3. 「Three.js + TypeScript で走る車を操作する 3D レーシングゲーム」

## スタック

| 役割            | ライブラリ             |
| --------------- | ---------------------- |
| 3D レンダリング | three ^0.165           |
| バンドラー      | vite ^5                |
| 型チェック      | typescript ^5.5        |
| E2E テスト      | @playwright/test ^1.45 |

## ディレクトリ構造（scaffold 直後）

```
<project>/
  index.html
  package.json
  tsconfig.json
  vite.config.ts
  playwright.config.ts
  src/
    main.ts
    scenes/
      MainScene.ts      ← Programmer が実装
    utils/
      rng.ts
  tests/
    e2e/
      smoke.spec.ts
      gameplay.spec.ts
  public/
    assets/
```

## Build / Test コマンド

```bash
# ビルド
pnpm install --prefer-offline --ignore-workspace && pnpm --ignore-workspace exec vite build

# テスト
pnpm install --prefer-offline --ignore-workspace \
  && pnpm --ignore-workspace exec playwright install chromium \
  && pnpm --ignore-workspace exec playwright test --reporter=line
```

## 評価基準

| id                        | 説明                                             | 必須 |
| ------------------------- | ------------------------------------------------ | ---- |
| `builds`                  | vite build がエラーなく完了                      | ✅   |
| `tests-pass`              | Playwright E2E 全スイート通過                    | ✅   |
| `entrypoints-implemented` | src/scenes/MainScene.ts が雛形から変更されている | ✅   |

## 変更履歴

| バージョン | 内容                     |
| ---------- | ------------------------ |
| 1.0.0      | 初版（2d-game から派生） |
