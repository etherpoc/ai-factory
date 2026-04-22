# `agents/artist/` — Artist エージェント (Phase 11.a)

Replicate SDXL 経由で画像アセットを生成する。スタイルガイドを先に決め、すべてのアセットに共通文脈を持たせる。

## 責務

- `workspace/<proj>/assets/images/` に PNG を配置
- `workspace/<proj>/assets-manifest.json` に一覧（スタイル + アセット配列 + 合計コスト）を出力
- Programmer がマニフェストを読んで実装に組み込む

## Tester / Critic との役割分離

- Artist: 「どう見せるか」を決め、生成する
- Tester: ファイルの物理的存在とマニフェスト整合を機械検証
- Critic: 完成品の見た目の主観評価

## 依存

- `core/providers/image/replicate.ts` 経由で SDXL
- `generate_image` ツールは `core/tools/asset-tools.ts` で構築（orchestrator が AssetGenerator と共に wire）

## 入出力

| 種類 | パス |
|---|---|
| 入力 | `spec.md`, `design.md` |
| 出力 | `workspace/<proj>/assets/images/*.png`, `workspace/<proj>/assets-manifest.json` |

## Phase C 自己検証

- `assets-manifest.json` が valid JSON
- 全 `assets[].path` が物理的に存在する
- `totalCostUsd` は実コストと一致（±0.0001）

## TOS / 著作権

- SDXL は CreativeML Open RAIL++-M License（商用可、禁止用途あり）
- 実在人物・著名キャラクター・既存 IP を模倣するプロンプトを生成しない

## 変更履歴

- **2026-04-22 (Phase 11.a.2)**: 初版。
