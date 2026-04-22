# recipes/\_template/ — 新レシピ雛形

## 概要

`meta/recipe-builder.ts` および手動作業の両方で、新しいレシピを作る際の**起点**。このディレクトリを `cp -r` して種別名に合わせた書き換えを行う。

## 同梱ファイル

- `recipe.yaml` — `PLACEHOLDER-TYPE` / `PLACEHOLDER` などのプレースホルダ付き
- `prompts/programmer.md` — スタック固有の実装規約を書く場所（雛形コメント付き）
- `template/.gitkeep` — `cp -r` で scaffold されるディレクトリ（新レシピ側で中身を入れる）

## 使い方

```
cp -r recipes/_template recipes/<new-type>
# 1. recipe.yaml の meta.type と各 PLACEHOLDER を書き換える
# 2. template/ にスタック最小構成のソースを置く
# 3. prompts/*.md に追加指示を書く（任意）
# 4. recipes/<new-type>/README.md を更新
# 5. tests/recipes/<new-type>.test.ts でスモーク検証
```

Phase 5 以降は `npx uaf add-recipe <type> "<description>"` でメタエージェントが同等の作業を自動化する。

## 変更履歴

- 2026-04-21 (Phase 0): 初版スタブ。
- 2026-04-21 (Phase 3): 中身を実装。`recipe.yaml`、`prompts/programmer.md`、`template/.gitkeep`。
