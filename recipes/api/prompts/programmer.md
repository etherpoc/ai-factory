# Programmer 規約 — api (Hono + Node.js + TypeScript)

## ディレクトリ構成

```
src/
  index.ts          # エントリポイント。app を named export し、serve() を条件付き起動
  routes/
    health.ts       # GET /health
    <resource>.ts   # リソースごとのルートファイル
  middleware/
    error.ts        # onError ハンドラ
  types.ts          # 共通型定義（Hono Env、リクエスト・レスポンス型など）
tests/
  health.test.ts    # ヘルスチェック統合テスト
  <resource>.test.ts
package.json
tsconfig.json
vitest.config.ts
```

## 必須コントラクト（Tester が依存する）

```typescript
// src/index.ts — app を named export すること（テストがインポートする）
export { app } from './app'; // または直接 export const app = new Hono()

// src/routes/health.ts — GET /health → 200 + { status: 'ok' }
health.get('/', (c) => c.json({ status: 'ok' }));
```

## Hono アプリ構成パターン

```typescript
// src/app.ts または src/index.ts 内
import { Hono } from 'hono';
import { health } from './routes/health';

const app = new Hono();

app.route('/health', health);

app.onError((err, c) => {
  return c.json({ error: err.message }, 500);
});

app.notFound((c) => {
  return c.json({ error: 'Not Found' }, 404);
});

export { app };
```

```typescript
// src/index.ts — NODE_ENV が test のとき listen しない
import { serve } from '@hono/node-server';
import { app } from './app';

if (process.env.NODE_ENV !== 'test') {
  serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 3000) }, (info) => {
    process.stdout.write(`Server running on http://localhost:${info.port}\n`);
  });
}

export { app };
```

## 使ってよいライブラリ

- `hono` — ルーティング、ミドルウェア、バリデーション
- `@hono/node-server` — Node.js アダプタ
- `zod` + `@hono/zod-validator` — 入力バリデーション（必要時）
- `tsx` — ts-node 代替（dev 実行用）
- `vitest`, `@vitest/coverage-v8` — テスト

## 使わないライブラリ・パターン

- `express` / `fastify` — Hono に統一する
- `any` 型 — `unknown` + type narrowing を使う
- `ts-node` — `tsx` で代替
- ルートファイル内での `serve()` 呼び出し — `src/index.ts` に集約
- `console.log` によるリクエストログ — ミドルウェアで構造化

## エラー処理

- HTTP エラーは `HTTPException` を `throw` する
  ```typescript
  import { HTTPException } from 'hono/http-exception';
  throw new HTTPException(404, { message: 'Resource not found' });
  ```
- 予期しないエラーは `app.onError` でキャッチし、500 を返す
- バリデーションエラーは `@hono/zod-validator` が自動で 400 を返す

## 非同期処理

- ルートハンドラは `async (c) => { ... }` で書き、`await` を使う
- エラーは try/catch で明示的にキャッチし、`HTTPException` を再スロー

## テストからの観測可能性

- `app` を named export することで `testClient(app)` または `createAdaptorServer(app)` でテストできる
- レスポンスボディは常に `{ data?: unknown, error?: string }` の形を守ると Tester が JSON を取りやすい
- 副作用（DB 書き込み等）は DI パターンで注入し `vi.mock` でモック可能にする
