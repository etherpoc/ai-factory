# UAF Mobile App

React Native + Expo (expo-router) + TypeScript で構築されたモバイルアプリの雛形。

## 開発

```bash
pnpm install --ignore-workspace
pnpm start          # Expo Go で開発サーバ起動
pnpm android        # Android エミュレータ
pnpm ios            # iOS シミュレータ
```

## 型チェック

```bash
pnpm build   # tsc --noEmit
```

## テスト

```bash
pnpm test    # jest-expo
```

## ディレクトリ構成

```
app/
  _layout.tsx    ルートレイアウト
  index.tsx      ホーム画面
src/
  components/    再利用コンポーネント
  hooks/         カスタムフック
  lib/           ビジネスロジック
  __tests__/     jest テスト
assets/          アセット
```
