# mobile-app レシピ

React Native + Expo (expo-router) + TypeScript + jest-expo を使った Android/iOS 共通モバイルアプリを生成するレシピ。

## 概要

このレシピは UAF（Universal Agent Factory）が「スマートフォン向けアプリを作って」系リクエストを受けたときに適用される型紙。  
expo-router によるファイルベースルーティングと jest-expo によるテストが最初から整備されており、Programmer エージェントはビジネスロジックの実装に集中できる。

---

## 適用されるリクエスト例

1. 「タスク管理アプリを React Native で作って。タスクの追加・完了・削除ができること」
2. 「天気予報を表示するモバイルアプリを Expo で作って。位置情報から現在地の天気を取得する」
3. 「フラッシュカード形式の英語学習アプリをスマートフォン向けに作って。単語と意味をカードでめくれる UI」

---

## スタック

| 項目 | 採用技術 |
|------|---------|
| フレームワーク | React Native 0.74 via Expo SDK 51 |
| ナビゲーション | expo-router v3 |
| 言語 | TypeScript 5.x (strict) |
| スタイリング | StyleSheet.create() |
| テストランナー | jest-expo |
| コンポーネントテスト | @testing-library/react-native |

---

## ディレクトリ構造（scaffold 直後）

```
.
├── app/
│   ├── _layout.tsx       ← ルートレイアウト（Stack / Tabs 設定）
│   └── index.tsx         ← ホーム画面
├── src/
│   ├── components/       ← 再利用可能コンポーネント
│   ├── hooks/            ← カスタムフック
│   ├── lib/              ← ビジネスロジック（React 非依存）
│   └── __tests__/
│       ├── setup.ts
│       └── HomeScreen.test.tsx
├── assets/               ← 画像・フォント等
├── app.json              ← Expo 設定
├── babel.config.js
├── package.json
└── tsconfig.json
```

---

## ビルド / テストコマンド

| コマンド | 内容 |
|---------|------|
| `pnpm install --prefer-offline --ignore-workspace` | 依存インストール |
| `pnpm --ignore-workspace exec tsc --noEmit` | 型チェック（CI ビルド） |
| `pnpm --ignore-workspace exec jest --passWithNoTests --forceExit` | ユニット + コンポーネントテスト |

> **注意**: Android/iOS の実機ビルド（`expo build` / EAS Build）はこのレシピの評価対象外。  
> ビルド評価は tsc の型チェック通過をもって代替する。

---

## 評価基準

| ID | 内容 | 必須 |
|----|------|------|
| `builds` | `tsc --noEmit` がエラーなく完了 | ✅ |
| `tests-pass` | jest が全テスト通過 | ✅ |
| `entrypoints-implemented` | `app/index.tsx` と `app/_layout.tsx` が stub から変更済み | ✅ |
| `testid-present` | `home-screen` testID を持つ要素が描画される | — |
| `no-any` | TypeScript の any 使用ゼロ | — |

---

## 変更履歴

| バージョン | 日付 | 内容 |
|-----------|------|------|
| 1.0.0 | 2025-01 | 初版作成（Expo SDK 51 / expo-router v3 / jest-expo） |
