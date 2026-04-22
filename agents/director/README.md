# agents/director/ — PM エージェント

## 責務

ユーザのリクエストから、実装可能な粒度の **PRD / GDD** (`workspace/<id>/spec.md`) を生成し、以降のスプリントで何を作るかを決定する。レビュワーから失敗レポートが返った際は、次サイクルのタスクリストに落とし込む。

## 入力

```ts
{
  request: string;                // ユーザ自然文
  recipe: Recipe;                 // 選択されたレシピ
  previousReport?: SprintReport;  // 2周目以降
}
```

## 出力

- `workspace/<id>/spec.md`（新規 or 追記）
- 次スプリントの `tasks: string[]`

## ファイル

- `prompt.md` — ベース system prompt（Phase 2 で記述）
- `index.ts` — `createDirector(recipe, workspace)` を export（Phase 2）

## 変更履歴

- 2026-04-21: 初版スタブ
