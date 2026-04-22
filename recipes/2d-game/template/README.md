# UAF 2D Game (scaffold)

Phaser 3 + TypeScript + Vite + Playwright の最小構成。`recipes/2d-game/` レシピ経由で workspace に展開される雛形。

## 開発

```bash
pnpm install
pnpm dev       # http://localhost:5173
pnpm build     # vite build
pnpm preview   # http://localhost:4173
pnpm test      # Playwright E2E（要: pnpm exec playwright install）
```

## 構成

- `src/main.ts` — Phaser.Game 初期化
- `src/scenes/MainScene.ts` — 置き換え対象のサンプルシーン
- `tests/e2e/smoke.spec.ts` — 起動スモークテスト

Programmer / Tester エージェントがこの雛形を拡張してリクエスト通りのゲームに仕立てる。
