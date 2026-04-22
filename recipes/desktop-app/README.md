# desktop-app レシピ

Electron + TypeScript + React でデスクトップアプリを生成するレシピ。macOS / Windows / Linux 共通で動作し、Vitest でメインプロセスとレンダラープロセスの両方をユニットテストできます。

## 適用されるリクエスト例

1. 「ファイルを読み込んでテキストを編集できる、シンプルなメモアプリを作って」
2. 「CSV ファイルをドラッグ＆ドロップしてグラフ表示できるデスクトップツールを作りたい」
3. 「ポモドーロタイマーをシステムトレイに常駐させるデスクトップアプリ」

## スタック

| 役割           | ライブラリ / ツール                |
|----------------|------------------------------------|
| シェル         | Electron 31                        |
| UI             | React 18 + CSS Modules             |
| 言語           | TypeScript 5                       |
| ビルド (renderer) | Vite 5 + @vitejs/plugin-react   |
| ビルド (main)  | tsc (CommonJS 出力)                |
| テスト         | Vitest 2 + @testing-library/react  |
| jsdom          | jsdom 24                           |
| パッケージ管理 | pnpm                               |

## ディレクトリ構成（scaffold 直後）

```
src/
  main/
    main.ts           BrowserWindow 生成・IPC 登録
    preload.ts        contextBridge API 公開
  renderer/
    index.html
    main.tsx          ReactDOM.createRoot
    App.tsx           ← Programmer が書き換えるエントリ
    App.module.css
    env.d.ts          Window.api 型拡張
    styles/
      global.css
  shared/
    preload-api.d.ts  ElectronAPI インターフェース
tests/
  renderer/
    setup.ts          jest-dom + window.api モック
    App.test.tsx      初期描画テスト
  main/
    ipc.test.ts       IPC ハンドラテスト
```

## ビルド / テストコマンド

```bash
# install
pnpm install --prefer-offline --ignore-workspace

# build (type-check main + vite build renderer)
pnpm --ignore-workspace exec tsc -p tsconfig.main.json --noEmit
pnpm --ignore-workspace exec vite build

# test
pnpm --ignore-workspace exec vitest run
```

## 評価基準

| ID                        | 必須 | 内容                                             |
|---------------------------|------|--------------------------------------------------|
| `builds`                  | ✅   | tsc (main) + vite build (renderer) が成功        |
| `tests-pass`              | ✅   | Vitest renderer + main 両プロジェクトが全通過    |
| `entrypoints-implemented` | ✅   | App.tsx と main.ts が scaffold から変更済み      |
| `ipc-contract`            | ❌   | contextBridge + contextIsolation が有効           |

## 変更履歴

| バージョン | 日付       | 内容             |
|------------|------------|------------------|
| 1.0.0      | 2025-07-14 | 初版作成         |
