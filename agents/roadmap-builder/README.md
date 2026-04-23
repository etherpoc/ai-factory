# agents/roadmap-builder/ — 実装計画立案エージェント (Phase 7.8)

## 役割

`spec.md` を入力として、ユーザーが進捗を追える粒度の **8〜15 タスクからなる実装ロードマップ** を生成する単発エージェント。orchestrator のループには入らず、`core/roadmap-builder.ts` から spec-wizard 完了後に 1 回だけ呼び出される。

## 入出力

- 入力: `AgentInput`（recipe / request / spec.md は workspace 内）
- 出力:
  - `workspace/<proj-id>/roadmap.md`（人間向けマークダウン、`write_file` で書き出す）
  - **テキスト応答に JSON**（`RoadmapJson`）を返す。`core/roadmap-builder.ts` が抽出して zod 検証 + topological sort して `state.json.roadmap` に保存。

## 使用ツール

- `read_file`: spec.md の読み込み
- `write_file`: roadmap.md の永続化

## モデル

`claude-sonnet-4-6`。タスク分解は構造的思考が必要。F18 ポリシー: Opus は使わない。

## 振る舞いの保証

- 8〜15 タスク（仕様が極小なら 6〜8、極大でも 18 まで）。
- DAG: `dependsOn` は循環不可。違反したら呼び出し側で reject。
- Verify 系タスク (テスト、最終ビルド) を最低 1 個含む。
- 言語は spec.md と同じ。

## 変更履歴

- 2026-04-23 (Phase 7.8.3): 新設。
