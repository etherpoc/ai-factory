# React Native + Expo 実装規約（Programmer エージェント向け）

## スタック概要

| 項目 | 選択 |
|------|------|
| フレームワーク | React Native 0.74+ via Expo SDK 51 |
| ナビゲーション | expo-router v3（ファイルベースルーティング） |
| 言語 | TypeScript 5.x（strict モード） |
| スタイリング | StyleSheet.create() |
| テスト | jest-expo + @testing-library/react-native |

---

## ディレクトリ構成（scaffold 直後）

```
app/
  _layout.tsx        ← ルートレイアウト（Stack / Tabs 設定）
  index.tsx          ← ホーム画面（/ ルート）
src/
  components/        ← 再利用可能なコンポーネント
  hooks/             ← カスタムフック (use<Name>.ts)
  lib/               ← ビジネスロジック（React 非依存の純粋関数）
  __tests__/         ← jest テストファイル
    setup.ts         ← jest セットアップ
assets/              ← 画像・フォント等のアセット
```

---

## エントリポイント契約（Tester が依存する — 変更禁止）

- `app/index.tsx` の root View に `testID="home-screen"` を付けること
- 各画面コンポーネントは `export default function <ScreenName>Screen()` で export する
- `src/lib/` 内のビジネスロジックは named export のみ（React に依存させない）
- カスタムフックは `use<Name>` 命名規則で `src/hooks/use<Name>.ts` に配置する

---

## ナビゲーション

expo-router のファイルベースルーティングを使う。`app/` フォルダ配下のファイルが自動的にルートになる。

```tsx
// 正しい画面遷移
import { router } from 'expo-router';
router.push('/detail');

// または Link コンポーネント
import { Link } from 'expo-router';
<Link href="/detail">詳細へ</Link>
```

`react-navigation` の `NavigationContainer` を直接使わないこと（expo-router が管理する）。

---

## UI / スタイリング

```tsx
import { StyleSheet, View, Text } from 'react-native';

export default function MyScreen() {
  return (
    <View style={styles.container} testID="my-screen">
      <Text style={styles.title}>タイトル</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: 'bold' },
});
```

- インラインスタイルを最小化し `StyleSheet.create()` に集約する
- testID は `kebab-case` で統一する
- プラットフォーム分岐は `Platform.select({ ios: ..., android: ... })` を使う

---

## アクセシビリティ

インタラクティブ要素には以下を付ける:

```tsx
<TouchableOpacity
  accessibilityRole="button"
  accessibilityLabel="送信する"
  testID="submit-button"
  onPress={handleSubmit}
>
```

---

## エラー処理・非同期処理

```tsx
// 非同期処理は必ず try/catch
async function fetchData() {
  try {
    const response = await fetch('https://api.example.com/data');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data: unknown = await response.json();
    // unknown を narrowing して使う
    return data;
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラー';
    console.error('fetchData failed:', message);
    throw error;
  }
}
```

- `callback` スタイル禁止。`async/await` に統一する
- `any` 禁止。`unknown` + type guard で narrowing する
- `ErrorBoundary` を `app/_layout.tsx` のトップに配置する

---

## 使ってよいライブラリ

- `expo-router` — ナビゲーション
- `expo-status-bar` — ステータスバー制御
- `@expo/vector-icons` — アイコン
- `expo-constants` — アプリ定数
- React Native 組み込みコンポーネント（View / Text / TextInput / FlatList / ScrollView 等）

## 使わないライブラリ

- `react-navigation` を直接使わない（expo-router 経由で統一）
- class コンポーネント禁止（関数コンポーネント + Hooks）
- `any` 型禁止

---

## 型の書き方

```ts
// Good
function parseUser(raw: unknown): User {
  if (typeof raw !== 'object' || raw === null) throw new Error('invalid user');
  const obj = raw as Record<string, unknown>;
  if (typeof obj['name'] !== 'string') throw new Error('invalid name');
  return { name: obj['name'] };
}

// Bad
function parseUser(raw: any): any { return raw; }
```
