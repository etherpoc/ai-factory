# UAF Web App (scaffold)

Next.js 14 (App Router) + TypeScript + Tailwind + Playwright の最小構成。`recipes/web-app/` レシピ経由で workspace に展開される雛形。

## 開発

```bash
pnpm install
pnpm dev       # http://localhost:3000
pnpm build
pnpm start     # 本番ビルド後のサーバ (Playwright が使う)
pnpm test      # Playwright E2E（要: pnpm exec playwright install）
```

## 構成

- `app/layout.tsx` — ルートレイアウト、Tailwind の global 読み込み
- `app/page.tsx` — `/` ルート（`data-testid="title"`）
- `app/globals.css` — `@tailwind base/components/utilities`
- `tests/e2e/smoke.spec.ts` — タイトル表示の smoke

Programmer / Tester エージェントがこの雛形を拡張してリクエスト通りの Web アプリに仕立てる。
