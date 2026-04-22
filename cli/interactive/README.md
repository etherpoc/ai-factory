# `cli/interactive/` — 対話ウィザード (Phase 7.4)

引数なしで `uaf` を実行した場合、あるいは必須引数が不足しているコマンド呼び出しで発動する対話 UI。`@inquirer/prompts` を薄くラップし、ESM + TypeScript + テスト可能性を担保している。

## ファイル

| ファイル | 役割 |
|---|---|
| `prompts.ts` | `@inquirer/prompts` の primitives をラップ。`Prompter` インタフェース、`withAbortHandling`（Ctrl-C → `UafError(USER_ABORT)`）、`defaultPrompter()` |
| `wizard.ts` | `runWizard`（トップメニュー）、`runCreateWizard`、`runAddRecipeWizard` |

## 設計方針

1. **テスト可能性**: すべてのウィザードは `WizardDeps` を受け取り、`prompter` / `runCreate` / `runAddRecipe` を DI できる。本番呼び出しでは `undefined` を渡して `defaultPrompter()` と動的 import に落とす。
2. **中断の一貫性**: Ctrl-C は `@inquirer/prompts` の `ExitPromptError` で throw される。これを `withAbortHandling` で `UafError(USER_ABORT)` に変換 → exit 8。
3. **遅延 import**: `@inquirer/prompts` は比較的重いので、`defaultPrompter()` が呼ばれるまで import しない。`uaf --help` / `uaf list` など対話不要のコマンドで起動コストを増やさない。
4. **トップメニューの範囲**: create / add-recipe / list / recipes / cost / doctor / exit の 7 項目。`open`, `clean`, `config` のようにキーワード引数前提のコマンドは直接呼び出してもらう（ウィザードからは外す）。

## Phase 7.5 で拡張する予定

- `runIterateWizard`（project-id 選択 → 差分リクエスト入力）
- `runConfigWizard`（config get/set/edit のハブ）

## 変更履歴

- **2026-04-22 (Phase 7.4)**: 初回実装。`prompts.ts` と `wizard.ts`、トップメニュー + create/add-recipe の対話フロー、`USER_ABORT` 変換、DI 可能な構造、テスト 20+ 件。
