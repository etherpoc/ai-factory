# Electron + React 実装規約（programmer 向け差し込み）

## ディレクトリ構成

```
src/
  main/
    main.ts        # BrowserWindow 生成・アプリライフサイクル
    preload.ts     # contextBridge で renderer に IPC API を公開
  renderer/
    main.tsx       # ReactDOM.createRoot エントリポイント
    App.tsx        # ルートコンポーネント
    components/    # 再利用コンポーネント
    styles/
      global.css   # グローバルスタイル
    env.d.ts       # Window.api 型拡張
  shared/
    preload-api.d.ts  # ElectronAPI インターフェース定義
dist/
  main/            # tsc でトランスパイルされた main/preload JS
  renderer/        # vite build で生成された HTML/JS
tests/
  main/            # Node 環境ユニットテスト
  renderer/
    setup.ts       # @testing-library/jest-dom + window.api モック
    *.test.tsx     # jsdom 環境コンポーネントテスト
```

## プロセス間通信 (IPC) の必須規約

- **`nodeIntegration: false` / `contextIsolation: true` を常に維持**
- `ipcMain.handle('channel-name', async (event, ...args) => { ... })` でハンドラを登録
- `preload.ts` の `contextBridge.exposeInMainWorld('api', { ... })` でのみ renderer に公開
- renderer からは `window.api.channelName(args)` として呼び出す
- IPC ハンドラ内で例外が発生したら必ず catch して `{ error: string }` を返す

## 型定義

`src/shared/preload-api.d.ts`:
```ts
export interface ElectronAPI {
  // 追加する IPC チャンネルに対応したメソッドをここに定義
  // 例: readFile(path: string): Promise<string>
}
```

`src/renderer/env.d.ts`:
```ts
/// <reference types="vite/client" />
declare global {
  interface Window {
    api: import('../shared/preload-api').ElectronAPI;
  }
}
export {};
```

## 必須テストコントラクト

対話 UI には以下の `data-testid` を付けること（Tester の renderer テストが依存する）:

| data-testid      | 用途                         |
|------------------|------------------------------|
| `app-title`      | アプリ名を示す見出し要素     |
| `primary-input`  | 主要な入力欄                 |
| `primary-action` | 主要なアクションボタン       |
| `item-list`      | アイテム一覧のコンテナ       |
| `item-entry`     | 各アイテム要素（複数）       |
| `item-delete`    | 各アイテム内の削除ボタン     |

ドメインに応じた命名に読み替えてよいが、`data-testid` 属性は必ず付ける。

## スタイリング

- CSS Modules (`ComponentName.module.css`) を優先する
- グローバルリセット・変数は `src/renderer/styles/global.css` に集約
- インラインスタイルは最後の手段

## エラー処理

- メインプロセス: `process.on('uncaughtException', (err) => console.error(err))` を必ず設定
- IPC ハンドラ: `try/catch` して renderer にエラー情報を返す
- renderer: IPC 呼び出しは `try/catch` してユーザーにエラーを表示する
- 非同期処理はすべて `try/catch` + `console.error` でログを残す

## 使ってよいライブラリ

- `electron`, `react`, `react-dom` — 必須コア
- `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event` — テスト
- `vitest`, `jsdom` — テストランナー / 環境
- `vite`, `@vitejs/plugin-react` — ビルドツール

## 使ってはいけないパターン

- `nodeIntegration: true` — セキュリティリスク
- renderer から `require('electron')` / `require('fs')` 直接呼び出し
- `any` 型 — `unknown` + type narrowing を使う
- `eval()` / `innerHTML` への動的 HTML 挿入
