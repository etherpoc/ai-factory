# `agents/writer/` — Writer エージェント (Phase 11.a)

UI ラベル、エラーメッセージ、README 本文、ストア説明文を一貫したトーン&マナーで生成する。

## 責務

- プロジェクト全体の文字列を `workspace/<proj>/copy.json` に集約
- dotted-key 構造で i18n 対応しやすい形に
- 他の creative agent とは独立（外部 API 不要、LLM のみ）

## Tester / Critic との役割分離

- Writer: 「何を書くか」を決める
- Tester: コードの動作を機械検証（Writer の成果物を読まない）
- Critic: 完成品の主観評価（トーンの良し悪しはここで判定）

## 入出力

| 種類 | パス |
|---|---|
| 入力 | `spec.md`, `design.md` |
| 出力 | `workspace/<proj>/copy.json` |

## Phase C 自己検証（Phase 11.a.3 で orchestrator に統合予定）

- `copy.json` が valid JSON
- 必須トップレベル: `tone`, `language`, `strings`
- 空でない `strings` マップ
- recipe.type 別の最低キーセット（例: 2d-game なら `game.title`, `game.start`）

## 変更履歴

- **2026-04-22 (Phase 11.a.2)**: 初版。LLM-only、外部 API 依存なし。
