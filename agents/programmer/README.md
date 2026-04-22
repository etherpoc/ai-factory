# agents/programmer/ — 実装エージェント

## 責務

`design.md` とタスクリストに従い、実際のソースコードを worktree に書き込む。ビルド/テストの失敗レポートが入力された場合はパッチを当てる。

## 入出力

- 入力: `{ design, tasks, lastFailure? }`
- 出力: ファイル変更のコミット差分

## ツール

`fs` 系（read/write/edit）、`shell`（限定コマンド — ビルド系のみ）。詳細プロンプトは Phase 2 で `prompt.md` に配置。

## 変更履歴

- 2026-04-21: 初版スタブ
