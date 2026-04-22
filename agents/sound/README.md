# `agents/sound/` — Sound エージェント (Phase 11.a)

ElevenLabs sound-generation 経由で BGM / SFX を生成する。

## 責務

- `workspace/<proj>/assets/audio/` に MP3 を配置
- `workspace/<proj>/audio-manifest.json` を出力（bgm / sfx 別配列、loop・volume 情報付き）
- Programmer が Howler などでマニフェストを読んで再生

## Tester / Critic との役割分離

- Sound: 「どんな音を鳴らすか」を決め生成
- Tester: ファイル存在・マニフェスト整合の機械検証
- Critic: 音の質・バランスの主観評価

## 依存

- `core/providers/audio/elevenlabs.ts`
- `generate_audio` ツール

## 制約

- ElevenLabs の duration_seconds は最大 22 秒。長い BGM はループ再生用に
- cli / api は音声不要のためこのエージェントはスキップされる（`recipe.agents.optional` に `sound` がない）

## 入出力

| 種類 | パス |
|---|---|
| 入力 | `spec.md`, `design.md` |
| 出力 | `workspace/<proj>/assets/audio/*.mp3`, `workspace/<proj>/audio-manifest.json` |

## Phase C 自己検証

- `audio-manifest.json` が valid JSON
- 全 path が物理的に存在
- `totalCostUsd` と実コストが整合

## TOS / 著作権

- 実在楽曲・既存 IP の模倣プロンプトは厳禁
- 音声クローン機能は使わない

## 変更履歴

- **2026-04-22 (Phase 11.a.2)**: 初版。
