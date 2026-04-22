# recipes/web-app/ — Next.js Web アプリ

## 概要

Todo・ブログ・ダッシュボードなどの Web アプリを生成するレシピ。スタックは **Next.js 14 (App Router) + TypeScript + Tailwind CSS**。E2E は Playwright で Desktop / Mobile 両ビューポートをカバー。

## 適用されるリクエスト例

- 「シンプルな Todo アプリを作って」
- 「ブログサイトを作って」
- 「Next.js の管理ダッシュボードを作って」

(classifier が「web」「todo」「ブログ」「ダッシュボード」「next」「tailwind」等で検出)

## スタック

| 項目           | 値                                      |
| -------------- | --------------------------------------- |
| 言語           | TypeScript (ES2022)                     |
| フレームワーク | Next.js 14 (App Router)                 |
| スタイル       | Tailwind CSS + PostCSS                  |
| E2E テスト     | Playwright (Desktop Chrome + Pixel 7)   |
| データ取得     | Server Components / Server Actions 優先 |

## ディレクトリ構造（scaffold 直後）

```
workspace/<id>/
├── package.json
├── next.config.mjs
├── tsconfig.json
├── tailwind.config.ts
├── postcss.config.mjs
├── playwright.config.ts
├── app/
│   ├── layout.tsx       # root layout (lang, metadata, Tailwind global import)
│   ├── page.tsx         # placeholder Home
│   └── globals.css      # Tailwind directives
└── tests/
    └── e2e/
        └── smoke.spec.ts
```

## ビルド / テスト

- **build**: `pnpm install --prefer-offline && pnpm build`（timeout 300s）
- **test**: `pnpm exec playwright install --with-deps chromium && pnpm exec playwright test --reporter=line`（timeout 600s）

## 評価基準

| id         | 必須 | 判定                                            |
| ---------- | ---- | ----------------------------------------------- |
| builds     | ✓    | `next build` が 0 で終了                        |
| tests-pass | ✓    | Playwright スイート全通過                       |
| responsive | ✓    | Desktop + Mobile ビューポートで主要フローが通る |

## エージェントへの追加指示

- **programmer**: App Router 規約、Server Components 既定、Tailwind でスタイル
- **tester**: 3 フロー（初回訪問 / 操作 / エッジ）を Desktop + Mobile で

## 変更履歴

- 2026-04-21 (Phase 4): 初版。Next.js 14 App Router + Tailwind + Playwright のミニマル雛形。
