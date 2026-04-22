# React Native + jest-expo テスト規約（Tester エージェント向け）

## テストスタック

| 項目 | 選択 |
|------|------|
| ランナー | jest-expo |
| コンポーネントテスト | @testing-library/react-native |
| 実行コマンド | `pnpm --ignore-workspace exec jest --passWithNoTests --forceExit` |
| テストファイル | `src/__tests__/*.test.tsx` / `src/__tests__/*.test.ts` |

---

## セットアップ

`src/__tests__/setup.ts` に以下を置く:

```ts
import '@testing-library/react-native/extend-expect';
```

`package.json` の `jest.setupFilesAfterFramework` でロードされる。

---

## コンポーネントテストの書き方

```tsx
import { render, screen, fireEvent } from '@testing-library/react-native';
import HomeScreen from '../../app/index';

describe('HomeScreen', () => {
  it('home-screen testID が存在する', () => {
    render(<HomeScreen />);
    expect(screen.getByTestId('home-screen')).toBeTruthy();
  });

  it('ボタンをタップするとカウントが増える', () => {
    render(<HomeScreen />);
    fireEvent.press(screen.getByTestId('increment-button'));
    expect(screen.getByText('1')).toBeTruthy();
  });
});
```

---

## 必須シナリオ（最低 3 件を必ず実装する）

### シナリオ 1: ホーム画面レンダリング
```tsx
it('ホーム画面が正常にレンダリングされる', () => {
  render(<HomeScreen />);
  expect(screen.getByTestId('home-screen')).toBeTruthy();
});
```

### シナリオ 2: 主要 UI インタラクション
```tsx
it('ユーザー操作で状態が変化する', async () => {
  render(<HomeScreen />);
  fireEvent.press(screen.getByTestId('action-button'));
  await waitFor(() => {
    expect(screen.getByTestId('result-text')).toBeTruthy();
  });
});
```

### シナリオ 3: ビジネスロジックのユニットテスト
```ts
// src/__tests__/lib.test.ts
import { myBusinessFunction } from '../../src/lib/myLib';

describe('myBusinessFunction', () => {
  it('正常系: 期待値を返す', () => {
    expect(myBusinessFunction('input')).toBe('expected');
  });

  it('異常系: 無効な入力で例外を投げる', () => {
    expect(() => myBusinessFunction('')).toThrow();
  });
});
```

### シナリオ 4: 非同期処理（fetch を含む画面）
```tsx
it('データフェッチ後にリストが表示される', async () => {
  jest.spyOn(global, 'fetch').mockResolvedValueOnce({
    ok: true,
    json: async () => [{ id: 1, name: 'Item 1' }],
  } as Response);

  render(<ListScreen />);
  await waitFor(() => {
    expect(screen.getByText('Item 1')).toBeTruthy();
  });
});
```

---

## セレクタ優先順位

1. `getByTestId('test-id')` — testID ベース（最優先）
2. `getByRole('button', { name: 'ラベル' })` — ARIA ロールベース
3. `getByText('テキスト')` — テキストベース（最終手段）

---

## 決定論性の担保

```ts
// 時刻固定
beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

// ランダム固定
jest.spyOn(Math, 'random').mockReturnValue(0.5);

// fetch モック
jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({}) } as Response);
```

---

## ネイティブモジュールのモック

```ts
// expo-camera をモック
jest.mock('expo-camera', () => ({
  Camera: 'Camera',
  useCameraPermissions: () => [{ granted: true }, jest.fn()],
}));

// AsyncStorage をモック
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
```

---

## よくある失敗と対策

| 失敗 | 原因 | 対策 |
|------|------|------|
| `act()` 警告 | 非同期更新を待っていない | `waitFor()` / `findBy*` を使う |
| `Cannot find module 'expo-router'` | jest の transform 設定ミス | `preset: 'jest-expo'` を確認 |
| `testID not found` | testID を付け忘れ | programmer 規約の testID 契約を確認 |
| タイムアウト | `--forceExit` 未指定 | jest コマンドに `--forceExit` を追加 |
