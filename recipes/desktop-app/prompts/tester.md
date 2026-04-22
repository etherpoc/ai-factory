# Vitest テスト指針（tester 向け差し込み）

## テスト構成

| ディレクトリ             | 環境     | 対象                                   |
|--------------------------|----------|----------------------------------------|
| `tests/renderer/*.test.tsx` | jsdom    | React コンポーネント / UI インタラクション |
| `tests/main/*.test.ts`   | node     | IPC ハンドラ / ビジネスロジック        |

## 必須 4 シナリオ

### Renderer（jsdom + @testing-library/react）

**1. 初期描画**
```tsx
import { render, screen } from '@testing-library/react';
import App from '../../src/renderer/App';

test('App renders app-title', () => {
  render(<App />);
  expect(screen.getByTestId('app-title')).toBeInTheDocument();
});
```

**2. アイテム追加**
```tsx
test('user can add an item', async () => {
  render(<App />);
  await userEvent.type(screen.getByTestId('primary-input'), 'new item');
  await userEvent.click(screen.getByTestId('primary-action'));
  expect(screen.getByText('new item')).toBeInTheDocument();
});
```

**3. アイテム削除**
```tsx
test('user can delete an item', async () => {
  render(<App />);
  // アイテムを追加してから削除
  await userEvent.type(screen.getByTestId('primary-input'), 'to delete');
  await userEvent.click(screen.getByTestId('primary-action'));
  const deleteBtn = screen.getByTestId('item-delete');
  await userEvent.click(deleteBtn);
  expect(screen.queryByText('to delete')).not.toBeInTheDocument();
});
```

### Main（node 環境）

**4. IPC ハンドラのユニットテスト**
```ts
import { vi, describe, it, expect } from 'vitest';

vi.mock('electron', () => ({
  app: { on: vi.fn(), whenReady: vi.fn(() => Promise.resolve()), quit: vi.fn() },
  BrowserWindow: vi.fn(() => ({ loadFile: vi.fn(), on: vi.fn(), webContents: { openDevTools: vi.fn() } })),
  ipcMain: { handle: vi.fn() },
}));

// ハンドラ関数を直接 import してテスト
import { someHandler } from '../../src/main/handlers';

describe('someHandler', () => {
  it('returns expected value', async () => {
    const result = await someHandler({} as Electron.IpcMainInvokeEvent, 'input');
    expect(result).toEqual({ success: true });
  });
});
```

## renderer/setup.ts（必須）

```ts
import '@testing-library/jest-dom';

// jsdom 環境では preload が実行されないため window.api をモックする
Object.assign(window, {
  api: {
    // IPC メソッドを vi.fn() でスタブ
    // 例: invoke: vi.fn(),
  },
});
```

## 決定性の確保

- `Math.random()` を使うロジック → `vi.spyOn(Math, 'random').mockReturnValue(0.42)` で固定
- 日付依存ロジック → `vi.useFakeTimers(); vi.setSystemTime(new Date('2026-01-01'))`
- `electron` モジュールは **必ず** `vi.mock('electron', () => ({ ... }))` でモックする
- `setTimeout` / `setInterval` → `vi.useFakeTimers()` + `vi.runAllTimers()`
- テスト終了後は `vi.restoreAllMocks()` / `vi.useRealTimers()` で元に戻す

## セレクタの優先順位

1. `screen.getByTestId('xxx')` — 最優先（実装の `data-testid` と 1:1 対応）
2. `screen.getByRole('button', { name: /追加/ })` — 次点
3. `screen.getByText(...)` — テキスト変更に弱いため慎重に

## vitest.config.ts の必須設定

vitest v2 では `projects` 配列内の `environment` 指定に制約があるため、**ファイルごとの docblock** でランタイムを切り替える方式を使う:

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const alias = {
  '@shared': path.resolve(__dirname, 'src/shared'),
  '@renderer': path.resolve(__dirname, 'src/renderer'),
};

export default defineConfig({
  plugins: [react()],
  resolve: { alias },
  test: {
    environment: 'node',          // default: main テスト用
    setupFiles: ['tests/setup-global.ts'],
    alias,
  },
});
```

renderer テストファイルの先頭に docblock を付けること:
```ts
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';   // ← /vitest サブパスが必須
```

`@testing-library/jest-dom` を直接インポートすると `expect is not defined` エラーになる。
必ず `@testing-library/jest-dom/vitest` を使うこと。
