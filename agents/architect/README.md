# agents/architect/ — 技術設計エージェント

## 責務

`spec.md` とレシピから、モジュール分割・データモデル・主要フロー・採用ライブラリを `design.md` に落とす。**実装はしない**。

## 入出力

- 入力: `{ spec: string, recipe: Recipe }`
- 出力: `workspace/<id>/design.md`

## ファイル

- `prompt.md`, `index.ts`（Phase 2）

## 変更履歴

- 2026-04-21: 初版スタブ
