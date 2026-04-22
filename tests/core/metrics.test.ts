import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { nullLogger } from '../../core/logger';
import { MetricsRecorder } from '../../core/metrics';

describe('metrics', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'uaf-metrics-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('appends JSONL records on wrap()', async () => {
    const rec = new MetricsRecorder({ projectId: 'proj-1', dir, logger: nullLogger });
    const result = await rec.wrap(
      { step: 'director', role: 'director', model: 'claude-opus-4-7' },
      async (ctx) => {
        ctx.usage({ inputTokens: 10, outputTokens: 20, cacheReadTokens: 3 });
        return 'hello';
      },
    );
    expect(result).toBe('hello');
    const content = await readFile(join(dir, 'metrics.jsonl'), 'utf8');
    const line = JSON.parse(content.trim());
    expect(line).toMatchObject({
      projectId: 'proj-1',
      role: 'director',
      model: 'claude-opus-4-7',
      inputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: 3,
      step: 'director',
    });
    expect(typeof line.durationMs).toBe('number');
  });

  it('still records when wrapped fn throws', async () => {
    const rec = new MetricsRecorder({ projectId: 'proj-2', dir, logger: nullLogger });
    await expect(
      rec.wrap({ step: 'boom', role: 'programmer' }, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const content = await readFile(join(dir, 'metrics.jsonl'), 'utf8');
    expect(content).toMatch(/"step":"boom"/);
  });
});
