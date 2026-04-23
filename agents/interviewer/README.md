# agents/interviewer/ — 仕様確認エージェント (Phase 7.8)

## 役割

ユーザーの自然言語リクエストに対して 3〜7 個の質問を投げ、`spec.md` を生成する **対話型エージェント**。orchestrator のループには入らず、`cli/interactive/spec-wizard.ts` から `runOrchestrator()` の前に 1 回だけ呼び出される。

## 入出力

- 入力: `AgentInput`（recipe / request / artifacts）
- 出力: `workspace/<proj-id>/spec.md` をツール経由で書き出す（戻り値は短いサマリ notes）

## 使用ツール

- `ask_user`: ユーザーへの質問（spec-wizard が runtime 登録）
- `write_file`: spec.md の永続化

## モデル

`claude-sonnet-4-6`。対話品質が UX に直結するため Haiku は使わない（F18 ポリシー: Opus も使わない）。

## 振る舞いの保証

- 質問回数は最大 7 個（プロンプト指示）+ ツール側で 12 個ハードリミット（R4 サーキットブレーカー）。
- 並列 `ask_user` 呼び出しは tool 内 mutex で直列化（readline 衝突回避）。
- spec.md は **ユーザーの言語**（日本語 or 英語）で書く。
- recipe のスタックを上書きする提案はしない。

## 非対話モード

`uaf create --spec-file <path>` を使うと spec-wizard は interviewer をスキップし、外部 spec.md を直接受け取る。CI / スクリプト用。

## 変更履歴

- 2026-04-23 (Phase 7.8.2): 新設。
