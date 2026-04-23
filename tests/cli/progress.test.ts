/**
 * Phase 7.8.10 — ProgressReporter rendering tests.
 *
 * Writes go to a PassThrough so we can assert on the produced string without
 * a real TTY. Color and emoji are forced off to keep snapshots stable.
 */
import { describe, expect, it } from 'vitest';
import { PassThrough } from 'node:stream';
import {
  createProgressReporter,
  nullProgressReporter,
} from '../../cli/ui/progress.js';

function collectStream(): { stream: NodeJS.WriteStream; read: () => string } {
  const pt = new PassThrough();
  const chunks: string[] = [];
  pt.on('data', (c: Buffer) => chunks.push(c.toString('utf8')));
  // The reporter sets `stream.isTTY` implicitly, so expose a mutable prop.
  const asWS = pt as unknown as NodeJS.WriteStream;
  Object.assign(asWS, { isTTY: false });
  return { stream: asWS, read: () => chunks.join('') };
}

describe('ProgressReporter', () => {
  it('phase + step + separator produce readable output without ANSI', () => {
    const { stream, read } = collectStream();
    const r = createProgressReporter({ stream, color: false, icons: false, width: 40 });

    r.phase('仕様を詰めていきます');
    r.step('対話中…');
    r.separator('仕様書プレビュー');
    r.blank();
    r.info('ready');

    const out = read();
    expect(out).toContain(':: 仕様を詰めていきます');
    expect(out).toContain('  対話中…');
    expect(out).toContain('-'.repeat(40));
    // In non-icons mode the separator title has no prefix, just indentation.
    expect(out).toMatch(/\n {2}仕様書プレビュー\n/);
    expect(out).toContain('i ready');
    // No ANSI escapes when color=false
    expect(out).not.toMatch(/\[/);
  });

  it('taskStart → complete prints both lines with an elapsed annotation', async () => {
    const { stream, read } = collectStream();
    const r = createProgressReporter({ stream, color: false, icons: false });
    const h = r.taskStart(3, 11, 'Phaser エンジン初期化');
    // complete with an explicit elapsed so the test is deterministic
    h.complete({ elapsedMs: 12_340, costUsd: 0.0321, note: 'overall 95' });
    const out = read();
    expect(out).toContain('[3/11] Phaser エンジン初期化');
    expect(out).toMatch(/進行中/);
    expect(out).toContain('OK 完了');
    expect(out).toContain('12秒'); // formatted duration
    expect(out).toContain('$0.0321');
    expect(out).toContain('overall 95');
  });

  it('taskStart → fail prints the reason', () => {
    const { stream, read } = collectStream();
    const r = createProgressReporter({ stream, color: false, icons: false });
    const h = r.taskStart(1, 2, 'build');
    h.fail('circuit breaker tripped');
    expect(read()).toContain('FAIL circuit breaker tripped');
  });

  it('preview wraps content with separators', () => {
    const { stream, read } = collectStream();
    const r = createProgressReporter({
      stream,
      color: false,
      icons: false,
      width: 20,
    });
    r.preview('hello\nworld\n', 'spec preview');
    const out = read();
    expect(out).toContain('spec preview');
    expect(out).toContain('hello\nworld');
    // Both borders present
    expect(out.match(/-{20}/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('nullProgressReporter is safely callable but silent', () => {
    expect(() => {
      nullProgressReporter.phase('x');
      nullProgressReporter.step('y');
      const h = nullProgressReporter.taskStart(1, 1, 'z');
      h.complete();
      h.fail('fail');
      nullProgressReporter.preview('content');
    }).not.toThrow();
  });
});
