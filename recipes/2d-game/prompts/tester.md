# Playwright E2E 指針（tester 向け差し込み）

## カバー必須の 3 シナリオ

1. **起動** — `page.goto('/')` → `page.locator('canvas')` が可視化されるまで待つ
2. **操作** — キーボードでゲーム状態が変わることを確認（例: キャラが動く、スコアが増える）
3. **終了** — ゲームオーバー or クリアの `data-testid` 要素が表示される

## セオリー

- `webServer.command` は `pnpm preview`（固定ポート、安定）を使う。`pnpm dev` は HMR 込みで不安定。
- `webServer.timeout` は 60s 以上。
- ページオブジェクトパターンは必須ではない。3 スペックなら直接 locator で書くほうが速い。
- canvas の中身を直接 assert するのは困難なので、DOM に `data-testid` を出して観測する。
- スクリーンショット比較は避ける（フォント・タイミング依存で flaky）。
- 決定性のため、Scene 側で `this.registry.set('seed', 42)` し、テストから `window.__uafSeed = 42` などで上書き可能な仕組みを用意させる。
