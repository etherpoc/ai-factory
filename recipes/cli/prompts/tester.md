# CLI Tester ガイド — Vitest + commander

## テストランナー

**Vitest** を使用する。実行コマンド:

```bash
pnpm --ignore-workspace --dir . test --run
```

テストファイルは `src/__tests__/*.test.ts` に配置する。

---

## テスト戦略

### レイヤー 1: ユニットテスト（`src/lib/`）

`src/lib/` の純粋関数は引数/戻り値だけでテストできる。副作用なし。

```typescript
import { describe, it, expect } from 'vitest';
import { myPureFunction } from '../lib/myModule.js';

describe('myPureFunction', () => {
  it('正常値を変換する', () => {
    expect(myPureFunction('input')).toBe('expected output');
  });
});
```

### レイヤー 2: コマンドテスト（`program.parseAsync`）

`src/cli.ts` から `program` を import して parseAsync でテスト。
stdout/stderr はスパイでキャプチャする。

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { program } from '../cli.js';

function makeCapture() {
  const out: string[] = [];
  const err: string[] = [];
  const spyOut = vi.spyOn(process.stdout, 'write').mockImplementation((s) => {
    out.push(String(s));
    return true;
  });
  const spyErr = vi.spyOn(process.stderr, 'write').mockImplementation((s) => {
    err.push(String(s));
    return true;
  });
  return {
    get stdout() {
      return out.join('');
    },
    get stderr() {
      return err.join('');
    },
    restore() {
      spyOut.mockRestore();
      spyErr.mockRestore();
    },
  };
}

describe('CLI', () => {
  let cap: ReturnType<typeof makeCapture>;

  beforeEach(() => {
    cap = makeCapture();
  });
  afterEach(() => {
    cap.restore();
    vi.clearAllMocks();
  });

  it('--help が exit 0 でヘルプを表示する', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
    await program.parseAsync(['node', 'cli', '--help']);
    expect(exitSpy.mock.calls[0]?.[0] ?? 0).toBe(0);
    exitSpy.mockRestore();
  });
});
```

---

## 必須テストシナリオ（最低 4 件）

| #   | シナリオ                      | 確認ポイント                                           |
| --- | ----------------------------- | ------------------------------------------------------ |
| 1   | `--help`                      | exit code 0、stdout にコマンド名が含まれる             |
| 2   | `--version`                   | stdout が `package.json` の version 文字列にマッチする |
| 3   | メインコマンドの正常系        | spec.md に書かれた出力が得られる                       |
| 4   | 不正引数 / 必須オプション欠落 | exit code 1、stderr にエラーメッセージが含まれる       |

spec.md に追加コマンドが定義されている場合、各コマンドにつき正常系 1 本 + 異常系 1 本を追加する。

---

## process.exit のハンドリング

commander はオプションエラー時に `process.exit(1)` を呼ぶ。
テスト内で exit が走ると Vitest が落ちるため、必ずスパイで置き換える:

```typescript
const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
// ... テスト ...
expect(exitSpy).toHaveBeenCalledWith(1);
exitSpy.mockRestore();
```

---

## 決定論性の担保

| リスク           | 対策                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------- |
| 日時依存         | `vi.useFakeTimers({ now: new Date('2025-01-01') })` + `afterEach(() => vi.useRealTimers())` |
| ファイルシステム | `node:os` の `tmpdir()` に一時ファイルを作り `afterEach` で削除                             |
| 外部コマンド実行 | `vi.mock('node:child_process', () => ({ execFile: vi.fn() }))`                              |
| 乱数             | `Math.random = vi.fn().mockReturnValue(0.5)`                                                |

---

## chalk / カラー出力への対処

chalk は TTY 検出でカラーを無効化する場合がある。
テスト時は `FORCE_COLOR=0` 環境変数をセットするか、出力の検証時に ANSI エスケープを除去する:

```typescript
const stripped = cap.stdout.replace(/\x1b\[[0-9;]*m/g, '');
expect(stripped).toContain('expected text');
```
