# UAF Desktop App — Scaffold

Electron + TypeScript + React のデスクトップアプリ雛形。

## 開発

```bash
pnpm install
pnpm dev        # renderer (Vite) + main (tsc --watch) 同時起動
```

## ビルド

```bash
pnpm build      # main (tsc) + renderer (vite build) 両方をビルド
pnpm start      # ビルド済みの Electron アプリを起動
```

## テスト

```bash
pnpm test       # Vitest (renderer: jsdom + main: node)
```

## ディレクトリ構成

```
src/
  main/           Electron メインプロセス
    main.ts       BrowserWindow 生成・IPC 登録
    preload.ts    contextBridge で renderer に API 公開
  renderer/       React レンダラープロセス (Vite でビルド)
    index.html
    main.tsx      ReactDOM.createRoot エントリ
    App.tsx       ルートコンポーネント ← Programmer が書き換える
  shared/
    preload-api.d.ts  ElectronAPI 型定義
tests/
  renderer/       jsdom 環境の React テスト
  main/           Node 環境の IPC ハンドラテスト
```
