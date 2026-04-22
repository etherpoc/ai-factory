# `cli/config/` — 設定ファイル機構 (Phase 7.2)

グローバル / プロジェクト別の 2 階層 YAML 設定をマージして、CLI から参照可能な **有効設定 (effective config)** を返す層。

## レイヤと優先順位

```
project (./.uafrc)            ← 最優先
  ↑ overrides
global  (~/.uaf/config.yaml)
  ↑ overrides
built-in defaults             ← 最低優先
```

`models` と `classifier` の 2 つのネストされたオブジェクトは **deep merge**（ロール単位で上書き）。それ以外のスカラーは位置による上書き。

## 主要 API

| 関数 | 用途 |
|---|---|
| `resolveConfigPaths(opts)` | プロジェクト / グローバルの **絶対パス**を返す |
| `readConfigFile(path)` | 1 つの YAML を読み込み zod 検証。存在しなければ `null` |
| `mergeConfigs(...layers)` | レイヤ配列を左→右で重ねて一つに合成 |
| `loadEffectiveConfig(opts)` | 全 3 層を読み込み `{ effective, sources, paths }` を返す |
| `getByDottedKey(cfg, key)` | `uaf config get <key>` 用 |
| `setByDottedKey(cfg, key, raw)` | `uaf config set <key> <value>` 用（型変換 + zod 検証） |
| `writeConfigFile(path, cfg)` | YAML シリアライズ + mkdir -p |
| `resolveWorkspaceDir(cfg, repoRoot, home?)` | workspace 保管場所の物理解決（`~` 展開、絶対パス通過、相対パス → repoRoot 基準） |

## スキーマ (抜粋)

```yaml
budget_usd: 2.00          # number > 0
max_iterations: 3         # int > 0
max_rounds: 30            # int > 0
workspace_location: ~/Documents/uaf-workspace   # ~ 展開対応
models:
  programmer: claude-sonnet-4-6
  tester: claude-haiku-4-5
classifier:
  default_type: 2d-game
editor: code              # uaf open / uaf config edit が使う
skip_prompts:
  - budget                # ウィザードでスキップする質問
```

`strict()` スキーマのため **未知のキーは拒否**（即座に `CONFIG_INVALID` = exit 4）。

## エラーコード

| UafError code | 意味 | exit code |
|---|---|---|
| `CONFIG_PARSE_ERROR` | YAML 文法違反 / 読み取り失敗 | 4 |
| `CONFIG_INVALID` | スキーマ違反 / 不正な値 | 4 |
| `CONFIG_WRITE_FAILED` | 書き込み失敗 | 4 |
| `CONFIG_NOT_FOUND` | 対象キーが存在しない | 7 |

## 変更履歴

- **2026-04-22 (Phase 7.2)**: 初回実装。`schema.ts` (zod strict)、`defaults.ts`、`loader.ts`（merge / 読取 / 書込 / dotted accessor）。テスト回帰 30 件以上。
