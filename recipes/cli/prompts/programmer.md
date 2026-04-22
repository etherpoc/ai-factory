# CLI Programmer ガイド — Node.js + TypeScript + commander

## スタック

| 項目         | 採用技術                            |
| ------------ | ----------------------------------- |
| 言語         | TypeScript 5.x                      |
| コマンド定義 | commander v12                       |
| カラー出力   | chalk v5（ESM）                     |
| 実行         | tsx（開発時） / tsc → dist/（本番） |
| テスト       | Vitest                              |

---

## ディレクトリ配置

```
src/
  cli.ts            # shebang + program 組み立て + export
  commands/
    index.ts        # サブコマンドをまとめて program に登録するファクトリ
    <name>.ts       # サブコマンド 1 つにつき 1 ファイル
  lib/
    <module>.ts     # コマンド非依存のビジネスロジック（純粋関数）
  __tests__/
    <name>.test.ts  # Vitest テストファイル
dist/               # tsc 出力先（.gitignore 済）
```

---

## エントリポイント必須コントラクト

Tester のテストがこの契約に依存します。**変えてはいけない**:

```typescript
// src/cli.ts — named export で program を公開
export const program = new Command();
// ... サブコマンド登録 ...

// bin として実行された場合のみ parse する
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  program.parseAsync(process.argv);
}
```

```typescript
// src/commands/<name>.ts
export function register<Name>(program: Command): void { ... }
// ハンドラ本体は export function handle<Name>(...) で外出し
```

---

## ライブラリ使用方針

### 使ってよい

- `commander` — `.command()` / `.option()` / `.argument()` で定義
- `chalk` — ターミナル出力の色付け（`chalk.green()` 等）
- `node:fs`, `node:path`, `node:os` などの Node.js 組み込み

### 使わない

- `yargs` / `meow` / `oclif` — commander に統一
- `inquirer` / `prompts` — spec に明示がなければ不使用
- `winston` / `pino` — CLI では `console.error()` で十分

---

## エラー処理

```typescript
// async コマンドハンドラのテンプレート
async function handleFoo(args: string[], opts: FooOptions): Promise<void> {
  try {
    // ... 処理 ...
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`Error: ${message}`));
    process.exit(1);
  }
}
```

`src/cli.ts` のトップレベルに下記を必ず入れる:

```typescript
process.on('unhandledRejection', (reason) => {
  console.error(chalk.red('Unhandled error:'), reason);
  process.exit(1);
});
```

---

## 型方針

- `any` 禁止。`unknown` を受け取ったら `instanceof Error` や型ガードで narrowing する
- commander option の型は interface を定義して明示する:

```typescript
interface FooOptions {
  output: string;
  verbose: boolean;
}
```

---

## ビルド設定

`tsconfig.json` は `"module": "NodeNext"` + `"outDir": "dist"` を基本とする。
`package.json` の `bin` フィールドで `dist/cli.js` を指す。

```json
{
  "bin": { "mycli": "./dist/cli.js" },
  "scripts": {
    "build": "tsc --noEmit false",
    "dev": "tsx src/cli.ts",
    "test": "vitest run"
  }
}
```

---

## 禁止パターン

- `process.exit()` をハンドラ外のモジュールトップで呼ばない（テスト時に困る）
- `console.log` を lib/ 内で直接呼ばない（戻り値で返して呼び出し元に判断させる）
- `require()` を使わない（`import` で統一、`"type": "module"` 前提）
