# `scripts/` — レガシー CLI ラッパーと運用ユーティリティ

Phase 7 で CLI 本体は [`cli/`](../cli/) 配下に移動した。このディレクトリに残っているのは以下の 2 種類:

## レガシー CLI ラッパー（Phase 0〜6 互換）

Phase 6 までのスモークスクリプト呼び出しを壊さないための薄いラッパー。内部で `cli/commands/*.ts` の関数を呼ぶだけ。**新規利用は `uaf` コマンドを推奨**。

| ファイル | 旧呼び方 | 新呼び方 |
|---|---|---|
| `scripts/run.ts` | `pnpm tsx scripts/run.ts --request "..."` | `uaf create "..."` |
| `scripts/add-recipe.ts` | `pnpm tsx scripts/add-recipe.ts --type X --description "..."` | `uaf add-recipe --type X --description "..."` |

**動作契約**: 引数の外部 I/F は Phase 6 の形を維持。内部で commander 経由の `cli/commands/{create,add-recipe}.ts` に渡す。終了コードは Phase 7 の終了コードポリシー（`cli/ui/exit-codes.ts`、0〜8）に完全移行。

## 運用ユーティリティ（Phase 7 も引き続き使用）

| ファイル | 用途 |
|---|---|
| `scripts/check-recipes.ts` | F19: 全レシピの構造検証。`uaf doctor` から呼ばれる予定 (Phase 7.5) |
| `scripts/recompute-metrics.ts` | `workspace/*/metrics.jsonl` から USD コストを再計算。`uaf cost` の実装基盤 |
| `scripts/diag-cache.ts` | プロンプトキャッシュの命中率を診断する開発者ツール |

## 削除予定

`uaf.mjs` は `package.json` の `bin` 登録で参照されていたが Phase 7 で `bin/uaf.js` に置き換わった（ファイルは元々存在しなかった）。この表記は削除済み。

## 変更履歴

- **2026-04-22 (Phase 7.3)**: `run.ts` / `add-recipe.ts` をラッパー化し、実装は `cli/commands/` に移動。終了コードを Phase 7 ポリシーに揃える。
- **2026-04-21 (Phase 0)**: 初版スタブ（実装は Phase 7）
