# Universal Agent Factory — プロジェクト現状レポート

**レポート作成日**: 2026年4月22日（最終更新: Phase 11.a 完了、使用期間移行時点）
**プロジェクト名**: `universal-agent-factory` (作業ディレクトリ: `C:\Users\ether\workspace\ai-factory`)
**現在フェーズ**: **Phase 11.a 完了、使用期間**

---

## 1. エグゼクティブサマリー

### プロジェクトの目的

ユーザーの自然言語リクエストから、**完全自動でゲーム・Webアプリ・モバイルアプリ・デスクトップアプリ・CLI・API 等を生成し、最終的にストアや配布先に公開可能な状態まで持っていくエンドツーエンドのマルチエージェントシステム**を構築する。

当初は「自動生成システム」として始めたが、利用者本人の真の目的が「ストアに出せる成果物を作る」ことであると判明したため、**ビルド・デプロイ・ストア公開支援まで**を射程に入れる方針に拡張されている。

### 到達点（Phase 11.a 完了時点）

- 基本7エージェント + recipe-builder メタエージェント + **4 creative agents（artist / sound / writer / critic）**動作
- 全 7 レシピ（2d-game / 3d-game / web-app / mobile-app / desktop-app / cli / api）で orchestrator 経由の動作確認完了
- recipe-builder が Phase C（自己検証）を必須化
- **外部アセットプロバイダ層（Replicate SDXL → Flux-schnell、ElevenLabs sound-generation）実装済み**
- **Programmer が生成済みアセット（画像・音声）をコードに組み込むフローが実機で動作**
- **Critic が実機で critique.md 出力、Tester との役割分離を実証**
- F18 完全決着（Opus ゼロ運用）、F19 + F20 対策完了
- 累計テスト **376 件**グリーン
- `uaf` CLI 10 コマンド完動（create / add-recipe / iterate / list / open / recipes / cost / clean / config / doctor）

### 現在のステータス

**Phase 11.a 完了。使用期間に入る**。Phase 11.b（運用 3 体: documenter / security-auditor / devops）または Phase 8（ビルド・パッケージング）への移行判断は、使用期間中の気づきを蓄積してから決める。

### 方針の再整理

- **利用者**: あなた個人の道具（OSS公開や商用化は当面考えない）
- **スコープ拡張**: CLI → ビルド → デプロイ → ストア公開支援 + Creative（画像・音声・コピー）の多段計画
- **優先種別**: 2d-game / 3d-game → web-app → mobile-app → その他

---

## 2. システム設計の原則

### R1. README ファースト原則

- プロジェクトルートの `README.md` がシステム仕様の正
- 機能追加・変更前に該当 README を先に更新する仕様駆動開発
- 各サブディレクトリにも個別 README を配置

### R2. レシピ拡張原則

新しいプロジェクト種別は `recipes/<type>/` にレシピを追加するだけで対応でき、コア層は変更不要。

### R3. 決定論的検証原則

すべてのエージェント出力は自動検証ツール（ビルド、Lint、テスト、E2E）で機械的に検証できる形式にする。LLM の判定だけで「完成」としない。

### R4. サーキットブレーカー原則

同じエラーが 3 回連続、またはイテレーション上限到達時に停止して人間に通知する。

### R5. コスト可観測性原則

各エージェント呼び出しのトークン消費・所要時間・使用モデルを `workspace/<proj-id>/metrics.jsonl` に記録する。

### R6. エージェント宣言原則 (Phase 11.a 実装)

レシピは使用する全エージェントを `agents.required` と `agents.optional` で明示する。orchestrator は宣言されたエージェントのみを起動する。

### R7. 外部API抽象化原則 (Phase 11.a 実装)

外部生成API（画像・音声）は必ず `core/asset-generator.ts` を経由。各エージェントが直接 API を叩かない。プロバイダ差し替えが容易であること。

### R8. アセットキャッシュ原則 (Phase 11.a 実装)

生成済みアセットは `workspace/<proj>/assets/.cache/<prefix>/<sha256>.<ext>` にキャッシュ。同一プロンプトでの再生成を避ける。

### R9. コスト上限原則 (Phase 11.a 実装)

- `--asset-budget-usd <amount>` CLI オプション
- レシピに `assets.budget.maxUsd` 設定可
- 超過時は `ASSET_BUDGET_EXCEEDED` を発火

---

## 3. 技術スタック

| 領域 | 採用技術 |
|------|---------|
| 言語 / ランタイム | TypeScript / Node.js 20+ |
| パッケージマネージャ | pnpm 10.33.0 |
| エージェント基盤 | Claude Agent SDK (`@anthropic-ai/sdk`) |
| オーケストレーション | 自前の軽量ループ |
| ブラウザ自動化 | Playwright (Chromium) |
| ワークスペース隔離 | plain-directory（F6 で git worktree から変更） |
| テスト | Vitest + nock (HTTP mock) |
| CLI | commander v14 + @inquirer/prompts + picocolors |
| 外部画像生成 | Replicate (Flux-schnell) |
| 外部音声生成 | ElevenLabs (sound-generation) |
| レート制限 | p-limit |
| 設定 | YAML（レシピ定義）、zod 検証、`.env`（APIキー） |

### LLMモデル（2026年4月時点の価格）

| モデル | 入力 | 出力 | cache read | cache write 5m |
|--------|------|------|-----------|---------------|
| Opus 4.7 | $5/M | $25/M | $0.50/M | $6.25/M |
| Sonnet 4.6 | $3/M | $15/M | $0.30/M | $3.75/M |
| Haiku 4.5 | $1/M | $5/M | $0.10/M | $1.25/M |

### 役割別モデル割当（DEFAULT_MODELS_BY_ROLE、Phase 11.a.6 更新後）

| ロール | モデル | 備考 |
|---|---|---|
| director / architect / programmer | Sonnet 4.6 | |
| tester / reviewer / evaluator | Haiku 4.5 | |
| artist / sound / writer | Sonnet 4.6 | Phase 11.a 追加 |
| **critic** | **Sonnet 4.6** | Phase 11.a.6 で Haiku → Sonnet に昇格（tool-use 遵守）|
| classifier | LLM 非使用 | ヒューリスティック |

### Opus 使用ポリシー

- **デフォルト経路に Opus なし**
- 明示オプトイン時のみ使用可能
- 万一選ばれた場合は `logger.warn` で source 属性含め記録（F18）
- F18 drift 検出テスト（10 role 分）が構造的ガード

---

## 4. アーキテクチャ

### ディレクトリ構造（Phase 11.a 完了時点）

```
universal-agent-factory/
├── README.md
├── bin/uaf.js                          # tsx ESM launcher
├── cli/                                # Phase 7 実装
│   ├── index.ts                        # commander router
│   ├── commands/                       # 10 commands
│   ├── interactive/                    # wizard (@inquirer/prompts)
│   ├── config/                         # zod schema + merge loader
│   ├── ui/                             # logger / errors / colors / exit-codes
│   └── utils/                          # workspace / snapshot / duration / editor
├── core/
│   ├── orchestrator.ts                 # resolveActiveRoles (Phase 11.a)
│   ├── classifier.ts
│   ├── recipe-loader.ts                # agents / assets スキーマ拡張
│   ├── agent-factory.ts
│   ├── workspace-manager.ts
│   ├── circuit-breaker.ts
│   ├── metrics.ts
│   ├── pricing.ts
│   ├── asset-cache.ts                  # Phase 11.a 新規
│   ├── asset-generator.ts              # Phase 11.a 新規
│   ├── strategies/claude.ts            # F17/F18、Phase 11.a creative 役割追加
│   ├── tools/
│   │   ├── index.ts                    # 5 builtin + DEFAULT_TOOLS_BY_ROLE
│   │   └── asset-tools.ts              # generate_image / generate_audio (11.a 新規)
│   ├── providers/                      # Phase 11.a 新規
│   │   ├── types.ts
│   │   ├── image/replicate.ts          # Flux-schnell (11.a.5 で SDXL→Flux)
│   │   └── audio/elevenlabs.ts         # sound-generation
│   └── types.ts
├── agents/
│   ├── director/ architect/ programmer/ tester/ reviewer/ evaluator/
│   └── artist/ sound/ writer/ critic/    # Phase 11.a 新規 4 体
├── meta/
│   └── recipe-builder.ts               # Phase 5、F19 Phase C 必須化
├── recipes/                            # 7 レシピ、11.a で agents/assets 拡張
│   ├── _template/
│   ├── 2d-game/ 3d-game/ web-app/ mobile-app/ desktop-app/ cli/ api/
├── scripts/
│   ├── run.ts add-recipe.ts            # 薄い CLI ラッパー (Phase 7)
│   ├── check-recipes.ts                # F19 構造検証
│   ├── recompute-metrics.ts            # コスト再計算
│   └── diag-cache.ts
├── tests/                              # 累計 376 件
│   ├── core/ meta/ recipes/ cli/
├── docs/
│   ├── spec.md                         # Phase 0〜6 原典
│   ├── spec-phase7.md                  # Phase 7 原典
│   ├── spec-phase11a.md                # Phase 11.a 原典
│   ├── COMMANDS.md                     # 全コマンドリファレンス
│   └── RECIPES.md                      # レシピ追加ガイド
├── workspace/                          # .gitignore — 生成物の隔離先
└── FINDINGS.md                         # 発見事項ログ
```

### オーケストレーションフロー（Phase 11.a 完了版）

```
User Request
  → Classifier (ヒューリスティック)
  → Director (PRD/GDD)
  → Architect (技術設計)
  → Scaffold (雛形展開)
  → Creative Phase (Phase 11.a 新規、並列):
      [Writer] [Artist] [Sound]   ← recipe.agents.optional で宣言されたものだけ
  → ┌─ LOOP ─────────────────────────────┐
    │ Programmer (manifest を read_file   │
    │             して実装に組み込む)     │
    │ Build                              │
    │ Tester                             │
    │ Critic (体験評価、critique.md)     │
    │ Reviewer                           │
    │ Evaluator                          │
    └─ done=true or 上限まで繰り返し     ┘
  → Report (REPORT.md + state.json + assets-manifest.json + audio-manifest.json + copy.json + critique.md)
```

---

## 5. フェーズ進捗

| Phase | 内容 | 状態 |
|-------|------|------|
| 0 | プロジェクト基盤 | ✅ 完了 |
| 1 | コア層 | ✅ 完了 |
| 2 | 汎用エージェント群 6 体 | ✅ 完了 |
| 3 | レシピ基盤 + 2d-game | ✅ 完了 |
| 4 | web-app + 抽象化検証 | ✅ 完了 |
| 5 | メタエージェント recipe-builder | ✅ 完了 |
| 6 | レシピ拡充（cli, api, 3d-game, mobile-app, desktop-app） | ✅ 完了 |
| 7 | CLI & DX（`uaf` 10 コマンド） | ✅ 完了 |
| 8 | ビルド・パッケージング | ⏳ 未着手 |
| 9 | デプロイ・公開自動化 | ⏳ 未着手 |
| 10 | ストア公開支援 | ⏳ 未着手 |
| **11.a** | **Creative Agents (artist / sound / writer / critic)** | ✅ **完了** |
| 11.b | 運用系3体 (documenter / security-auditor / devops) | ⏸ 未着手 |

### Phase 計画改訂の背景

Phase 6 完走後に「ストアに出せる成果物を作る」という真の目的が判明。Phase 7 → 11.a 順で進め、使用期間を挟んで実運用フィードバックを蓄積。Phase 11.b / Phase 8 の優先度は使用期間中に判断。

---

## 6. テスト状況

- **ユニット + 統合テスト**: 累計 **376 件**グリーン (Phase 0〜11.a の積み上げ)
- **実機生成成功実績（Phase 11.a E2E）**:
  - 2d-game クリッカー: 音声 3 件生成、画像は初回 SDXL 404 で Phaser primitives fallback
  - web-app メモ帳: Flux-schnell で画像 3 件、writer が copy.json 22 キー
  - 2d-game 避けゲー (再実行): 画像 5 件 + 音声 5 件、**コードに 13 箇所埋め込み、vite build 成功**、critique.md 生成
- **主要回帰テスト**:
  - F7: 空 scaffold 遮断
  - F17: strategy extras forward
  - F18: Opus opt-in (4 件) + drift 検出 (10 role)
  - F19: Phase C 自己検証必須化
  - F20: workspace path 短縮
  - Phase 11.a.2: Programmer が generate_image/audio を持たない regression lock
  - Phase 11.a.3: resolveActiveRoles (13 件)、recipe schema backward compat (10 件)
  - Phase 11.a.6: critic を Sonnet で固定する drift lock

---

## 7. 発見事項（FINDINGS）履歴

### 解決済み

| ID | 内容 | 結果 |
|----|------|------|
| F1〜F17 | Phase 0〜6 の発見事項 | すべて解決、詳細は [`FINDINGS.md`](./FINDINGS.md) |
| F18 | 出所不明の Opus 4.7 使用 | Anthropic 集計ラグ、内部経路なしを確定。drift 検出テストで継続監視 |
| F19 | recipe-builder が Phase C をスキップ | 必須化、エビデンス検証、アトミックロールバック |
| F20 | Windows で長い日本語 workspace path が pnpm hoist 失敗 | projectId を `<timestamp>-<short-hash>` に変更 |

### Phase 11.a 固有の学び

| 項目 | 内容 |
|----|------|
| **Replicate SDXL の deprecated 化** | `stability-ai/sdxl` の shortcut endpoint が 2026-04 時点で 404。Flux-schnell (`black-forest-labs/flux-schnell`) に移行。Flux は width/height でなく aspect_ratio を要求するため provider に変換ロジックを追加 |
| **Critic の Sonnet 昇格判断 (Phase 11.a.6)** | Haiku 4.5 は tool-use 遵守が弱く、critique 内容を chat text でのみ返して `write_file('critique.md', …)` を呼ばない事例が発生。Sonnet に昇格して解決。コスト差 ~$0.30/call 増だが信頼性を優先 |
| **artist の Flux-schnell 成功率** | プロンプト改善（20 単語以上、著名 IP 回避）でも 5/13 (38%) に留まる。Flux の safety filter が厳しめ。flux-dev や imagen-4-fast への切替検討候補 |
| **Programmer の manifest 参照** | Phase 11.a.5 時点では Programmer が manifest を無視する事象発生。prompt.md に「生成済みアセットの取り込み」セクションを明示追加して解決（11.a.6） |
| **BudgetTracker の call 中超過** | pre-check 方式のため、大きな Programmer/Artist の 1 call で $0.5 以上オーバーすることがある。現状仕様として受容 |

### 運用上の保留

| ID | 内容 | 状態 |
|----|------|------|
| F15 | Console 集計と内部メトリクスの乖離 | 「Console を真値」方針で収束。`uaf cost` は現存 workspace のみ集計、真値は console.anthropic.com |

---

## 8. コスト実績

### フェーズ別累計実コスト

| フェーズ | 内容 | 累計コスト (Phase 単独) |
|---------|------|----------|
| Phase 0〜4 | 基盤・コア・2d-game・web-app | 約 $8 |
| Phase 5 | メタエージェント recipe-builder | 約 $1.29 |
| Phase 6 | レシピ拡充 | 約 $7.45 |
| F18 調査 + 集計ラグ | | 約 $1.86 |
| Phase 7 (CLI & DX) | | $0.78 |
| **Phase 11.a (Creative)** | 11.a.1〜11.a.6 | **$7.93** |
| **累計（現 workspace ベース）** | `uaf cost --period all` | **$12.02** |
| **累計（Console 真値、Phase 0〜）** | 削除済み workspace 含む | **約 $27.30** |

### F17 修正の効果（キャッシュ効率、Phase 6 時点）

- cache ratio: Sonnet 85% / Haiku 76%
- F17 修正前（全Opus）: 2 iter で $1.91
- F17 修正後（Sonnet + cache）: 2 iter 換算で約 $0.80
- **-58% のコスト削減**を維持

### F18 Opus ゼロ運用の維持

Phase 5 以降、全 metrics.jsonl で claude-opus の呼び出し **0 件**を維持。opt-in warn も未発火。Phase 11.a.6 完了時点で 66 LLM calls 中 0 件。drift 検出テストで構造的に保証。

### Console CSV 照合用ウィンドウ（Phase 11.a E2E）

| Scenario | 開始 (UTC) | 終了 (UTC) | 経過 |
|---|---|---|---|
| 1 (2d-game クリッカー) | 2026-04-22T08:37:11Z | 2026-04-22T08:44:13Z | 7 分 |
| 3 (web-app メモ帳) | 2026-04-22T08:47:22Z | 2026-04-22T09:01:42Z | 14 分 |
| 4 (2d-game 避けゲー) | 2026-04-22T09:08:20Z | 2026-04-22T09:32:58Z | 25 分 |
| 4 再実行 (11.a.6) | 2026-04-22T09:54:36Z | 2026-04-22T10:14:09Z | 20 分 |

すべての区間で期待モデル分布: sonnet / haiku / n/a のみ、**Opus 0 件**。

---

## 9. 残存課題（Phase 11.a 完了後、使用期間で蓄積）

### 中優先度

| 課題 | 影響 | 対応候補 |
|---|---|---|
| `recipes/2d-game/recipe.yaml` の entrypoints が `MainScene.ts` を指すが、Programmer は Title/Game/GameOver シーンを作る | entrypoints-implemented が常に fail、overall が 33/100 止まり | entrypoint を `src/main.ts` に変えるか、Programmer prompt で MainScene.ts 必ず書き換え |
| artist の Flux-schnell 成功率 ~38% | 画像不足でゲームの見栄えが下がる | flux-dev（高品質版）への switch、または imagen-4-fast を代替プロバイダに追加 |
| BudgetTracker の call 中超過 | `--budget-usd` が $0.5 程度オーバーすることあり | 現状仕様として許容、または call 前に estimate してスキップ |

### 低優先度

| 課題 | 影響 | 対応候補 |
|---|---|---|
| Phase C 自己検証が creative agents では未実装 | critique.md / copy.json の内容不正を orchestrator が検知できない | evaluator の criteria に `critique-exists` / `copy-valid-json` 等を recipe に追加 |
| ElevenLabs pinging timeout (`uaf doctor`) | doctor で warn が出るが fail ではない | timeout 15s → 30s にするか、ping endpoint を変更 |
| generate_image の rate limit 時の挙動 | 連続失敗の復旧が保守的すぎる | リトライ戦略を強化 |

---

## 10. 次のアクション

### 直近: 使用期間

Phase 11.a 完成品を実使用する期間。目的:
- Phase 11.b（documenter / security-auditor / devops）の必要性と優先度を見極める
- Phase 8（ビルド・パッケージング）の具体要件を固める
- 残存課題の実運用影響を体感

記録器: `USAGE_DIARY.md` に日々の気づきを追記。

### 使用期間終了後の判断

1. **Phase 11.b**: 運用が大事になる局面で必要性が見えたら優先
2. **Phase 8 以降**: ストア公開が現実味を帯びたら着手
3. **残存課題修正**: 実害が大きいものから

### Phase 8 以降のロードマップ

- **Phase 8**: ビルド・パッケージング — `uaf build <proj-id>`、種別別パッケージング（zip / ipa / aab / dmg / exe / docker）
- **Phase 9**: デプロイ・公開自動化 — `uaf deploy <proj-id> --target <target>`、web: Vercel / Netlify、api: Fly.io / Railway、cli: npm publish、GitHub Actions 自動生成
- **Phase 10**: ストア公開支援 — ストア用素材、プライバシーポリシー、提出チェックリスト。itch.io → Vercel → App Store / Google Play の順

---

## 11. 引き継ぎ・再開用メモ

### 重要な運用原則

- **メトリクスの自己申告は疑う** — Console での CSV 照合を定期実施
- **「修正済」≠「動作確認済」** — 外部検証を挟む習慣を維持
- **README更新は実装と同時に** — R1 原則
- **Opus 使用は警戒** — F18 drift 検出テスト + Console 照合
- **人間主導の設計判断を尊重** — Phase 7、11.a の仕様議論は人間が主導した

### Phase 11.a の主要な設計決定

1. **外部プロバイダ抽象化** — エージェントは `asset-generator` しか知らない。provider 差し替え容易
2. **並列実行** — writer / artist / sound は architect 後に並列で走り、Programmer が待つ
3. **critic の loop 内位置** — tester の後、reviewer の前
4. **シンプルな role 解決** — `shouldUseAgent(role, spec, recipe)` で自動判定せず、CLI フラグ + 予算で opt-out だけ
5. **Phase C 相当** — 現状は orchestrator の評価器が代替、専用実装は後続

### 参照すべき主要ドキュメント

- `CLAUDE_CODE_PROMPT.md` — 元の実装指示書（Phase 0〜7）
- `CLAUDE_CODE_PROMPT_EXT_CREATIVE.md` — Creative/Ops 拡張指示書（Phase 11 の叩き台）
- `CLAUDE_CODE_PROMPT_PHASE7.md` — Phase 7 仕様
- `CLAUDE_CODE_PROMPT_PHASE11A.md` — Phase 11.a 仕様
- `docs/spec-phase7.md` / `docs/spec-phase11a.md` — 上記のプロジェクト内コピー
- `docs/COMMANDS.md` — 全 uaf コマンドのリファレンス
- `docs/RECIPES.md` — レシピ追加ガイド
- `FINDINGS.md` — 発見事項ログ
- `USAGE_DIARY.md` — 使用期間の気づき（新規）
- 本レポート（`PROJECT_STATUS_REPORT.md`）— 現状整理

### 環境確認コマンド

```powershell
pnpm test                              # 全テスト実行（376件）
pnpm exec playwright --version         # Playwright 確認
cat .env | Select-String "ANTHROPIC|REPLICATE|ELEVENLABS"   # APIキー確認（3 種）
pnpm tsx scripts/check-recipes.ts      # レシピ構造検証（F19）
pnpm test opus-opt-in                  # Opus opt-in 回帰テスト
uaf doctor                             # 環境 10 項目チェック
uaf cost --period all                  # コスト集計（Opus 0 件確認）
```

### コスト監視

- 定期的に [console.anthropic.com](https://console.anthropic.com/) → Usage で CSV 出力
- 大きな実行後は自己申告と実コンソールを必ず照合
- Replicate: [replicate.com/account](https://replicate.com/account/billing) で画像生成コスト確認
- ElevenLabs: [elevenlabs.io/app/usage](https://elevenlabs.io/app/usage) で音声生成コスト確認

### 累計コスト状況と今後の見込み

| 期間 | 実コスト | 内容 |
|------|---------|------|
| Phase 0〜6 累計 | 約 $18.60 | 基盤構築 〜 全レシピ自動生成実証 |
| Phase 7 | $0.78 | CLI & DX |
| Phase 11.a | $7.93 | Creative agents + 実機検証 |
| **現時点の累計（Console 真値想定）** | **約 $27.30** | Phase 11.a 完了時点 |
| 使用期間 | $5〜10/月見込み | 実運用による |
| Phase 11.b | $5〜10 | 運用 3 体 |
| Phase 8〜10 | $15〜25 | ビルド・デプロイ・ストア |
| **プロジェクト全体予想累計** | **$50〜70** | ストア公開可能な成果物自動生成まで |

---

**このレポート末尾**
