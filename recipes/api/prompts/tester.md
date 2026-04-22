# Tester 規約 — api (Hono + Vitest 統合テスト)

## テストランナー

**Vitest** (`vitest run`) + Hono の `testClient` または `createAdaptorServer` + supertest

```typescript
// 推奨: Hono testClient（型安全、supertest 不要）
import { testClient } from 'hono/testing';
import { app } from '../src/index';

const client = testClient(app);
const res = await client.health.$get();
expect(res.status).toBe(200);
```

```typescript
// 代替: supertest + @hono/node-server の createAdaptorServer
import request from 'supertest';
import { createAdaptorServer } from '@hono/node-server';
import { app } from '../src/index';

const server = createAdaptorServer(app);
const res = await request(server).get('/health');
expect(res.status).toBe(200);
```

## 最低カバーシナリオ（3 件以上必須）

### シナリオ 1: ヘルスチェック（必須）

```typescript
describe('GET /health', () => {
  it('200 と { status: "ok" } を返す', async () => {
    const res = await request(server).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
```

### シナリオ 2: リソース正常系 CRUD

```typescript
describe('POST /items', () => {
  it('新しいアイテムを作成し 201 を返す', async () => {
    const res = await request(server).post('/items').send({ name: 'test-item' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.name).toBe('test-item');
  });
});

describe('GET /items/:id', () => {
  it('作成済みアイテムを取得できる', async () => {
    // POST で作成してから GET
    const created = await request(server).post('/items').send({ name: 'x' });
    const res = await request(server).get(`/items/${created.body.id}`);
    expect(res.status).toBe(200);
  });
});
```

### シナリオ 3: エラー系

```typescript
describe('GET /items/:id (存在しない)', () => {
  it('404 を返す', async () => {
    const res = await request(server).get('/items/nonexistent-id');
    expect(res.status).toBe(404);
  });
});

describe('POST /items (バリデーション失敗)', () => {
  it('必須フィールド欠落で 400 を返す', async () => {
    const res = await request(server).post('/items').send({});
    expect(res.status).toBe(400);
  });
});
```

## テストファイル配置

```
tests/
  health.test.ts      # GET /health
  items.test.ts       # リソース CRUD（spec で定義されたリソースに合わせる）
  error.test.ts       # 404 / バリデーションエラー
```

## 決定論性の担保

- ID が自動生成される場合は `vi.mock` でモック、または `crypto.randomUUID` に `vi.spyOn` を使う
- 各テストスイートはインメモリストアをリセットする（`beforeEach` で空配列 / Map を再初期化）
- ファイル IO や外部 HTTP は `vi.mock` で差し替える

## vitest.config.ts の最低設定

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    coverage: {
      provider: 'v8',
      thresholds: { lines: 70 },
    },
  },
});
```

## 禁止事項

- テスト内で実際の DB / ネットワークに接続しない
- `test.only` や `test.skip` を残したままにしない
- テストファイルに `console.log` を残さない
