# API App

Hono + TypeScript + Node.js による REST API サーバの骨組みです。

## 起動

```bash
pnpm install
pnpm dev      # tsx watch による開発サーバ (port 3000)
```

## ビルド確認

```bash
pnpm build    # tsc --noEmit
```

## テスト

```bash
pnpm test
pnpm test:coverage
```

## エンドポイント

| Method | Path    | Description    |
| ------ | ------- | -------------- |
| GET    | /health | ヘルスチェック |

## ディレクトリ構成

```
src/
  index.ts          エントリポイント（serve 条件起動）
  app.ts            Hono インスタンス・ルート登録
  routes/
    health.ts       GET /health
tests/
  health.test.ts    統合テスト
```
