# recipes/cli — Node.js CLI レシピ

## 概要

TypeScript + commander + chalk + tsx の組み合わせで **Node.js 製 CLI ツール** を生成するレシピ。
ビルドは `tsc`、テストは `vitest`、開発実行は `tsx` で完結する。
`bin` フィールドで `dist/cli.js` を指し、`npm link` / `npx` で直接呼べる形にする。

## 適用されるリクエスト例

1. 「ファイルを受け取って CSV→JSON に変換する CLI ツールを作って」
2. 「git のコミットログを集計してレポートを出す Node.js CLI ツールが欲しい」
3. 「複数のサブコマンドを持つタスク管理 CLI を TypeScript で実装して」

## スタック一覧

| 役割                    | パッケージ  | バージョン目安 |
| ----------------------- | ----------- | -------------- |
| コマンド定義            | commander   | ^12            |
| カラー出力              | chalk       | ^5（ESM）      |
| TypeScript 実行（開発） | tsx         | ^4             |
| 型チェック / ビルド     | typescript  | ^5             |
| テスト                  | vitest      | ^1             |
| 型定義                  | @types/node | ^20            |

## scaffold 直後のディレクトリ構成

```
<project>/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── .gitignore
├── README.md
└── src/
    ├── cli.ts               # エントリポイント（program を named export）
    ├── commands/
    │   ├── index.ts         # registerCommands(program) ファクトリ
    │   └── hello.ts         # scaffold stub — Programmer が実際の機能に置換
    └── __tests__/
        └── cli.test.ts      # スモークテスト 4 本
```

## ビルド / テストコマンド

```bash
# 依存インストール
pnpm --ignore-workspace install

# TypeScript → dist/ にビルド
pnpm --ignore-workspace --dir . build

# テスト実行（--run で watch 無効化）
pnpm --ignore-workspace --dir . test --run
```

## 評価基準

| 基準 ID                   | 内容                                                  | 必須 |
| ------------------------- | ----------------------------------------------------- | ---- |
| `builds`                  | `tsc` が exit 0 で完了する                            | ✅   |
| `tests-pass`              | vitest が全テスト通過する                             | ✅   |
| `entrypoints-implemented` | `src/cli.ts` / `src/commands/index.ts` が stub でない | ✅   |
| `help-exits-zero`         | `node dist/cli.js --help` が exit 0                   | —    |
| `version-flag`            | `--version` が package.json version を出力する        | —    |

## Programmer へのキーポイント

- `src/cli.ts` は **`export const program`** を必ず named export すること（Tester が import する）
- サブコマンドは `src/commands/<name>.ts` に分割し `registerCommands` から呼ぶ
- ビジネスロジックは `src/lib/` に切り出して純粋関数にする（テスタビリティ確保）
- `process.exit()` はコマンドハンドラの catch ブロックのみで呼ぶ

## 変更履歴

- 2025-07-04: 初版作成（cli-1776791218107 からの recipe-builder 自動生成）
