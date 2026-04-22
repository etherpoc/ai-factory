# `agents/critic/` — Critic エージェント (Phase 11.a)

完成した成果物の **主観評価** を行う。Tester が「動くか」、Critic が「魅力的か / 使いやすいか」。

## Tester との役割分離（最重要）

| | Tester | Critic |
|---|---|---|
| 軸 | 動くか | 魅力的か / 使いやすいか |
| 方法 | ビルド、vitest、Playwright | スクショ・ログの観察 |
| 出力 | `testReport` | `critique.md` |
| 扱い | 失敗は必修正 | 次イテレーションの優先度ヒント |

- 重複作業を避けるため、Critic は Tester のテスト結果を再検証しない
- Tester は動作確認、Critic は体験評価。混同しないこと

## 責務

- `workspace/<proj>/critique.md` を生成
- 総合スコア 0〜10 + 評価軸別スコア + 改善提案

## 使えるツール

- `read_file`, `list_dir`, `write_file`
- `bash`（Playwright でスクショ再生成可）

## 対象外

- cli / api レシピ（主観評価の必要性が低い）
- recipe.agents.optional に含まれていなければスキップ

## Phase C 自己検証

- `critique.md` の存在
- `## 総合スコア: N/10` が正規表現で抽出可能
- `## 改善提案` セクションに最低 3 項目

## 変更履歴

- **2026-04-22 (Phase 11.a.2)**: 初版。
