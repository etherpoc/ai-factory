# recipes/api — Hono REST API レシピ

## 概要

Hono + TypeScript + Node.js による最小構成の REST API サーバを生成するレシピです。
`@hono/node-server` アダプタで起動し、Vitest + supertest 相当の統合テストを標準装備します。
型安全・ゼロ依存のルーティングで、任意のリソース CRUD API をすばやく scaffold できます。

## 適用リクエスト例

1. 「ToDoリストを管理する REST API を作って（POST /todos, GET /todos, DELETE /todos/:id）」
2. 「ユーザー登録・ログインができる認証 API サーバが欲しい」
3. 「社内の商品在庫を CRUD できる JSON API を TypeScript で作って」

## スタック

| 役割                | パッケージ                  |
| ------------------- | --------------------------- |
| HTTP フレームワーク | hono                        |
| Node.js アダプタ    | @hono/node-server           |
| 言語                | TypeScript 5                |
| テストランナー      | Vitest 3                    |
| 統合テスト          | supertest / hono testClient |
| カバレッジ          | @vitest/coverage-v8         |
| Dev サーバ起動      | tsx                         |

## scaffold 直後のディレクトリ構造

```
.
├── src/
│   ├── index.ts          # エントリポイント（serve 条件起動 + app re-export）
│   ├── app.ts            # Hono インスタンス・ルート登録
│   └── routes/
│       └── health.ts     # GET /health → { status: 'ok' }
├── tests/
│   └── health.test.ts    # スモーク統合テスト
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── .gitignore
└── README.md
```

## build / test コマンド

```bash
# ビルド確認（型チェック）
pnpm install --prefer-offline --ignore-workspace && pnpm --ignore-workspace exec tsc --noEmit

# テスト
pnpm install --prefer-offline --ignore-workspace && pnpm --ignore-workspace exec vitest run --reporter=verbose
```

## 評価基準

| id                      | 必須 | 説明                                                          |
| ----------------------- | ---- | ------------------------------------------------------------- |
| builds                  | ✅   | tsc --noEmit がエラーなく完了                                 |
| tests-pass              | ✅   | vitest run が全スイート通過                                   |
| entrypoints-implemented | ✅   | src/index.ts と src/routes/health.ts が雛形から変更されている |
| health-endpoint         |      | GET /health が { status: 'ok' } を返す実装が存在する          |

## 変更履歴

- 2026-04-21: 初版。Hono + Vitest 構成で api レシピを新規作成。
