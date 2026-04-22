# cli-app — scaffold

> **このファイルは scaffold 直後の骨組みです。**  
> Programmer エージェントが spec.md に従い `hello` コマンドを実際の機能に置き換えます。

## セットアップ

```bash
pnpm install
pnpm build   # tsc → dist/
pnpm test    # vitest run
```

## 開発時の実行

```bash
pnpm dev -- hello --name World
# または
node dist/cli.js hello --name World
```

## ディレクトリ構成

```
src/
  cli.ts              # エントリポイント・program export
  commands/
    index.ts          # サブコマンド登録ファクトリ
    hello.ts          # scaffold stub（Programmer が置き換える）
  __tests__/
    cli.test.ts       # Vitest テスト
dist/                 # tsc 出力（.gitignore）
```
