# agents/tester/ — 自動テストエージェント

## 責務

ユニットテストと **Playwright** E2E を生成・実行し、結果を JSON で返す。主要ユーザフロー最低 3 つをカバー（レシピ側で上書き可能）。

## 入出力

- 入力: `{ design, recipe.test }`
- 出力: `{ passed: number, failed: number, failures: FailureDetail[] }`

## 変更履歴

- 2026-04-21: 初版スタブ（Playwright 統合は Phase 2 step 14）
