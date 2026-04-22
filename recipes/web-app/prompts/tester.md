# Playwright E2E 指針（tester 向け差し込み）

## 必須 3 フロー

1. **初回訪問** — `/` を開いて主要 UI（ヘッダ、メインコンテンツ）が描画される
2. **ユーザー操作** — CRUD 系: アイテム追加→表示→削除 の一連。ダッシュボード系: 絞り込み→表示切替
3. **エッジケース** — 空状態 / バリデーションエラー / 非同期ローディング完了 のうち 1 つ以上

## 実行環境

- `webServer.command` は `pnpm start`（= `next start`）。`pnpm dev` は HMR で flaky。前段で `pnpm build` を走らせる設定を `playwright.config.ts` の `webServer` に書く。
- `projects` に `Desktop Chrome` と `iPhone 14`（Mobile Chrome）の 2 つを並べる — `responsive` 評価基準の必須要件。
- `timeout` は全体 30s、`expect.timeout` は 5s 程度で十分。

## セレクタ

- `page.getByTestId('xxx')` を最優先。
- 次点で `page.getByRole('button', { name: /保存/ })`。
- `page.locator('.class')` は最後の手段（壊れやすい）。

## 決定性

- DB・API を使う場合は、テスト前後で `beforeAll` / `afterAll` でリセット。
- 固定シード、固定日付 (`new Date('2026-01-01')`) を使う。
- スクリーンショット比較・タイミング依存の sleep はしない（`expect(...).toHaveText(...)` など async assertion を使う）。
