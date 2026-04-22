# UAF 3D Game — scaffold

Three.js + Vite + TypeScript による 3D ブラウザゲームの雛形です。
Programmer エージェントがこの骨格に実際のゲームロジックを実装します。

## 開発

```bash
pnpm install
pnpm dev       # http://localhost:5173
pnpm build     # dist/ に出力
pnpm preview   # http://localhost:4173（E2E テスト用）
pnpm test      # Playwright E2E
```

## ディレクトリ構造

```
src/
  main.ts              # WebGLRenderer + アニメーションループ
  scenes/
    MainScene.ts       # メインシーン（Programmer が実装）
  utils/
    rng.ts             # シード付き乱数
public/
  assets/              # テクスチャ・モデルなど
tests/
  e2e/
    smoke.spec.ts      # canvas 起動確認
    gameplay.spec.ts   # プレイヤー移動（Programmer 実装後に通過）
```
