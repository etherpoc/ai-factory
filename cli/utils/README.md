# `cli/utils/` — CLI ヘルパ層

`cli/commands/` から切り出した純粋関数群。**core/** には一切触れない。

| ファイル | 用途 |
|---|---|
| `workspace.ts` | `state.json` の read/write、projects 一覧、snapshot ディレクトリの命名・探索 |
| `duration.ts` | `7d` / `2w` / `1M` のパース、ms ⇄ human 文字列 |
| `editor.ts` | `$EDITOR` 解決と spawn、デフォルトブラウザ起動 |

## state.json 設計

- **書き手**: `uaf create` (初回)、`uaf iterate` (追記)
- **置き場所**: `workspace/<proj-id>/state.json`
- **スキーマ**: `WorkspaceStateSchema` (zod)
- **容認する欠損**: 古い Phase 6 までの workspace には state.json がない。`readWorkspaceState` は `null` を返す設計で、`uaf list` は state なしの workspace も mtime で表示する

## Snapshot 設計

- **置き場所**: `workspace/.snapshots/<proj-id>-<YYYYMMDDhhmmss>/`
- **発動タイミング**: `uaf iterate` の LLM 呼び出し直前
- **削除**: `uaf clean` が workspace 本体と同じポリシー（`--older-than`）で削除対象に含める
- **世代管理**: Phase 7.5 では「無制限に残す → clean で整理」方式。将来 cap が必要なら `--keep-snapshots N` 的なフラグで拡張

## 変更履歴

- **2026-04-22 (Phase 7.5)**: 初版。state.json スキーマ、snapshot 命名規則、duration パーサ、editor ラップ。
