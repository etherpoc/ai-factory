# `core/providers/` — 外部 API プロバイダ層

Phase 11.a.1 で導入。R7（外部API抽象化原則）の実装。エージェントは **この層より下を知らない**。

## 原則

- エージェントは `asset-generator` のみを import する
- プロバイダ差し替え（Replicate → Fal.ai、ElevenLabs → Suno 等）で上層は無変更
- `ImageSpec` / `AudioSpec` が唯一の I/F、戻り値は `ProviderOutput` で統一
- 認証・レート制限・リトライはプロバイダ実装の責務

## ファイル

```
core/providers/
├── types.ts                # ImageProvider, AudioProvider, ImageSpec, AudioSpec, ProviderError
├── image/
│   ├── replicate.ts        # Replicate SDXL
│   └── index.ts            # ImageProviderRegistry
└── audio/
    ├── elevenlabs.ts       # ElevenLabs sound-generation (SFX + BGM)
    └── index.ts            # AudioProviderRegistry
```

## エラー

全プロバイダは `ProviderError` を投げる。`code` の種類:

| code | 意味 | retryable |
|---|---|---|
| `API_KEY_MISSING` | 認証情報が空 | false |
| `RATE_LIMIT` | 429 | true |
| `UNAUTHORIZED` | 401 | false |
| `REQUEST_FAILED` | その他 4xx | false |
| `CREATE_FAILED` | 予測作成失敗 (Replicate) | 5xx のみ true |
| `POLL_FAILED` | ポーリング失敗 (Replicate) | 5xx のみ true |
| `GENERATION_FAILED` | モデルが失敗 | false |
| `CANCELED` | 予測キャンセル | false |
| `TIMEOUT` | タイムアウト | true |
| `DOWNLOAD_FAILED` | 成果物取得失敗 | 5xx のみ true |
| `NO_OUTPUT` | 成功ステータスだが出力なし | false |
| `EMPTY_BODY` | 空レスポンス | false |
| `UNSUPPORTED_KIND` | プロバイダ非対応の kind | false |
| `PROVIDER_NOT_FOUND` | レジストリに無いプロバイダ名 | false |
| `NO_PROVIDERS` | レジストリが空 | false |
| `ASSET_BUDGET_EXCEEDED` | 予算超過 (generator が発火) | false |

## TOS / ライセンス

- **Replicate SDXL**: CreativeML Open RAIL++-M License。商用可だが禁止用途あり（詳細は Replicate のモデルページ）。
- **ElevenLabs sound-generation**: 商用利用可。音声クローンや実在人物の模倣は利用規約で制限。
- エージェント側プロンプト（`agents/artist/prompt.md`, `agents/sound/prompt.md`）で「実在人物・著名キャラクターを模倣する指示を生成しない」を明示する責務。

## テスト

- `tests/core/providers/replicate.test.ts` — nock で Replicate API をモック
- `tests/core/providers/elevenlabs.test.ts` — nock で ElevenLabs API をモック
- 実 API を叩く E2E は `tests/` ではなく Phase 11.a.5 の `uaf create --recipe ...` で検証

## 変更履歴

- **2026-04-22 (Phase 11.a.1)**: 初版。types / Replicate / ElevenLabs / registries を配置。`ProviderError` の 16 種類コードを定義。レート制限は `p-limit`（デフォルト 2 並列）。
