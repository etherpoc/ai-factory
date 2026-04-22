/**
 * Phase 7.7 integration tests for `uaf cost`.
 *
 * Verifies end-to-end: seeded metrics.jsonl → aggregation → stdout.
 * Opus highlight behavior is locked to keep F18 monitoring honest.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCost } from '../../cli/commands/cost.js';

let tmp: string;
let savedCwd: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'uaf-cost-'));
  await mkdir(join(tmp, 'workspace'), { recursive: true });
  savedCwd = process.cwd();
  process.chdir(tmp);
});
afterEach(async () => {
  process.chdir(savedCwd);
  await rm(tmp, { recursive: true, force: true });
});

function captureStdout(): { written: () => string; restore: () => void } {
  const chunks: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.stdout.write as any) = (chunk: string | Uint8Array): boolean => {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  };
  return {
    written: () => chunks.join(''),
    restore: () => {
      process.stdout.write = orig;
    },
  };
}

async function seedMetrics(
  pid: string,
  rows: Array<{
    role: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
    ts?: string;
  }>,
): Promise<void> {
  const dir = join(tmp, 'workspace', pid);
  await mkdir(dir, { recursive: true });
  const lines = rows.map((r) =>
    JSON.stringify({
      ts: r.ts ?? '2026-04-22T00:00:00.000Z',
      projectId: pid,
      role: r.role,
      model: r.model,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      cacheReadTokens: r.cacheReadTokens ?? 0,
      cacheCreationTokens: r.cacheCreationTokens ?? 0,
      durationMs: 1000,
      step: `${r.role}:${r.model}`,
    }),
  );
  await writeFile(join(dir, 'metrics.jsonl'), lines.join('\n') + '\n', 'utf8');
}

describe('uaf cost — integration', () => {
  it('reports zero when no metrics exist', async () => {
    const cap = captureStdout();
    try {
      await runCost({ period: 'all' });
    } finally {
      cap.restore();
    }
    const out = cap.written();
    expect(out).toContain('calls total : 0');
    expect(out).toContain('cost total  : $0.0000');
    expect(out).toContain('opus usage  : 0 calls');
  });

  it('sums across multiple projects', async () => {
    await seedMetrics('a', [{ role: 'director', model: 'claude-sonnet-4-6', inputTokens: 1000, outputTokens: 500 }]);
    await seedMetrics('b', [{ role: 'programmer', model: 'claude-haiku-4-5', inputTokens: 2000, outputTokens: 1000 }]);
    const cap = captureStdout();
    try {
      await runCost({ period: 'all' });
    } finally {
      cap.restore();
    }
    const out = cap.written();
    expect(out).toContain('calls total : 2');
    expect(out).toMatch(/cost total {2}: \$0\./);
    expect(out).toContain('claude-sonnet-4-6');
    expect(out).toContain('claude-haiku-4-5');
  });

  it('highlights Opus usage when present (F18 monitoring)', async () => {
    await seedMetrics('opus', [
      { role: 'director', model: 'claude-opus-4-7', inputTokens: 500, outputTokens: 200 },
    ]);
    const cap = captureStdout();
    try {
      await runCost({ period: 'all' });
    } finally {
      cap.restore();
    }
    const out = cap.written();
    expect(out).toMatch(/opus usage {2}: 1 calls — investigate/);
  });

  it('filters by period=today (cutoffs yesterday)', async () => {
    const yesterday = new Date(Date.now() - 48 * 60 * 60_000).toISOString();
    const today = new Date().toISOString();
    await seedMetrics('old', [
      { role: 'director', model: 'claude-sonnet-4-6', inputTokens: 1000, outputTokens: 500, ts: yesterday },
    ]);
    await seedMetrics('new', [
      { role: 'director', model: 'claude-sonnet-4-6', inputTokens: 2000, outputTokens: 1000, ts: today },
    ]);
    const cap = captureStdout();
    try {
      await runCost({ period: 'today' });
    } finally {
      cap.restore();
    }
    const out = cap.written();
    // Only the `new` project should contribute.
    expect(out).toContain('calls total : 1');
  });

  it('emits JSON when --json is set', async () => {
    await seedMetrics('j', [{ role: 'tester', model: 'claude-haiku-4-5', inputTokens: 100, outputTokens: 50 }]);
    const cap = captureStdout();
    try {
      await runCost({ period: 'all', json: true });
    } finally {
      cap.restore();
    }
    const data = JSON.parse(cap.written()) as { total: { calls: number }; opusCalls: number };
    expect(data.total.calls).toBe(1);
    expect(data.opusCalls).toBe(0);
  });
});
