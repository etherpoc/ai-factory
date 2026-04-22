# Usage Diary — Universal Agent Factory

Phase 11.a 完了後の実使用記録。Phase 11.b / 8 以降の設計材料。

## 記録方針

- 日付ごとに気づきを記録
- 「試したこと」「結果」「気づき/要望」の3項目
- 使った日だけで OK

---

## 記録開始

### YYYY-MM-DD

**試したこと**:

**結果**:

**気づき/要望**:

---

## 残存課題メモ（Phase 11.a.6 から引き継ぎ）

- [ ] **entrypoints 整合性**: `recipes/2d-game/recipe.yaml` の entrypoint が `MainScene.ts` を指すが Programmer は Title/Game/GameOver を作る傾向。entrypoints-implemented が常に fail して overall が 33/100 止まりになる。`entrypoints` を `src/main.ts` に変更するか、Programmer prompt で `MainScene.ts` を必ず書き換えるよう指示追加が必要
- [ ] **artist 成功率 38%**: Flux-schnell の safety filter 拒否率が高い。`flux-dev`（高品質版）または `imagen-4-fast` への切替を検討
- [ ] **BudgetTracker の call 中超過**: pre-check 方式のため、大きな Programmer/Artist の 1 call で $0.5 程度オーバーすることあり。現状仕様として受容中
- [ ] **Phase C 自己検証（creative）**: critique.md / copy.json の内容不正を orchestrator が自動検知できない。recipe 側で `critique-exists` / `copy-valid-json` 評価基準を追加するのが簡単
- [ ] **ElevenLabs doctor ping timeout**: `uaf doctor` で `api.elevenlabs.io/v1/user` が 15s 超えることあり（warn 扱い、fail ではない）

---

## 次フェーズ優先度メモ

使用期間中に「これが欲しい」と強く感じたものを追記。ここに書いたものが多い項目から次フェーズの優先度を決める。

### Phase 11.b (運用系) 優先度

- **documenter**: （まだ記録なし）
- **security-auditor**: （まだ記録なし）
- **devops**: （まだ記録なし）

### Phase 8 (ビルド・パッケージング) 優先度

- （まだ記録なし）

### Phase 9 (デプロイ) / Phase 10 (ストア公開) 優先度

- （まだ記録なし）

### その他の改善要望

- （まだ記録なし）

---

## 使用期間終了時の振り返り

使用期間を終える時（明確な終了日はない、節目で）に以下を埋める。

- **最も使ったコマンド**: 
- **最も困ったこと**: 
- **最も嬉しかったこと**: 
- **次に優先すべき**: 
- **Phase 11.a の完成度への満足度（10点満点）**: 
- **使用期間での累計コスト**:
  - LLM (Anthropic):
  - Replicate:
  - ElevenLabs:
  - 合計:

---

## 参考: 現時点で動作が確認されているコマンド

```bash
# セットアップ
uaf doctor                              # 環境 10 項目チェック (REPLICATE/ELEVENLABS ping 込み)
uaf recipes                              # 7 種別一覧

# 生成
uaf create "リクエスト" --recipe <type> --budget-usd <usd> --asset-budget-usd <usd>
uaf create --no-assets                   # アセット生成をスキップ（LLM だけで完結）
uaf create --skip-critic                 # Critic をスキップ

# 運用
uaf list                                 # 生成済みプロジェクト一覧
uaf list --recipe 2d-game --status completed
uaf open <proj-id>                       # エディタで開く
uaf iterate <proj-id> "差分リクエスト"   # 既存プロジェクトに差分追加
uaf cost --period all                    # コスト集計（Opus 0 件確認）
uaf clean --older-than 30d --dry-run     # 古い workspace の整理
uaf config list                          # 設定確認
```

実際に使ってみて「動かない」「期待と違う」があれば、そのコマンドと状況を記録すること。
