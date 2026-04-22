import { describe, it, expect, vi, afterEach } from 'vitest';

// chalk のカラーコードを除去してアサーションを単純にする
process.env['FORCE_COLOR'] = '0';
process.env['NO_COLOR'] = '1';

// commander が --help / --version / エラー時に呼ぶ process.exit をモック
// ファイルスコープで 1 度だけ設置し、各テストで clearAllMocks() でリセット
const exitSpy = vi
  .spyOn(process, 'exit')
  .mockImplementation((() => {}) as (code?: number) => never);

// 遅延 import: スパイ設置後に program を読み込む（トップレベル await は vitest が許可）
const { program } = await import('../cli.js');

// ANSI エスケープ除去ユーティリティ
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

/**
 * stdout / stderr をキャプチャするヘルパー。
 * 返り値の restore() を afterEach / finally で必ず呼ぶこと。
 */
function makeCapture() {
  const outChunks: string[] = [];
  const errChunks: string[] = [];

  const spyOut = vi.spyOn(process.stdout, 'write').mockImplementation((s: string | Uint8Array) => {
    outChunks.push(String(s));
    return true;
  });
  const spyErr = vi.spyOn(process.stderr, 'write').mockImplementation((s: string | Uint8Array) => {
    errChunks.push(String(s));
    return true;
  });

  return {
    get stdout() {
      return stripAnsi(outChunks.join(''));
    },
    get stderr() {
      return stripAnsi(errChunks.join(''));
    },
    restore() {
      spyOut.mockRestore();
      spyErr.mockRestore();
    },
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('CLI scaffold smoke tests', () => {
  it('--help が exit code 0 でヘルプテキストを出力する', async () => {
    const cap = makeCapture();
    try {
      await program.parseAsync(['node', 'cli', '--help']);
      // commander v12 は writeOut() で stdout に直接書く。
      // process.exit(0) を呼ぶ前に出力が完了している。
      const allOut = cap.stdout + cap.stderr;
      expect(allOut).toMatch(/cli-app|Usage/i);
      // exit が呼ばれた場合は code が 0 であること（呼ばれない場合も OK）
      const calls = exitSpy.mock.calls;
      if (calls.length > 0) {
        expect((calls[0]?.[0] as number | undefined) ?? 0).toBe(0);
      }
    } finally {
      cap.restore();
    }
  });

  it('--version が package.json の version 文字列を出力する', async () => {
    const cap = makeCapture();
    try {
      await program.parseAsync(['node', 'cli', '--version']);
      const allOut = cap.stdout + cap.stderr;
      expect(allOut).toMatch(/\d+\.\d+\.\d+/);
    } finally {
      cap.restore();
    }
  });

  it('hello コマンドがデフォルト名で挨拶を出力する', async () => {
    const cap = makeCapture();
    try {
      await program.parseAsync(['node', 'cli', 'hello']);
      expect(cap.stdout).toContain('Hello, World!');
    } finally {
      cap.restore();
    }
  });

  it('hello --name で任意の名前に挨拶する', async () => {
    const cap = makeCapture();
    try {
      await program.parseAsync(['node', 'cli', 'hello', '--name', 'Alice']);
      expect(cap.stdout).toContain('Hello, Alice!');
    } finally {
      cap.restore();
    }
  });
});
