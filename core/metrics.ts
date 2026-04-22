import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { AgentRole, Logger, MetricRecord } from './types.js';

export type MetricRole = MetricRecord['role'];

export interface MetricsRecorderOptions {
  projectId: string;
  /** Directory that will contain `metrics.jsonl`. Usually the workspace root. */
  dir: string;
  logger: Logger;
}

export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  model?: string;
}

export interface WrapOptions {
  step: string;
  role: MetricRole;
  /** Default model recorded if the wrapped fn doesn't override via ctx.usage. */
  model?: string;
}

export interface WrapContext {
  /** Called by the wrapped fn to attach LLM usage metadata. */
  usage(u: Usage): void;
}

const DEFAULT_MODEL = 'n/a';

export class MetricsRecorder {
  private readonly filePath: string;

  constructor(private readonly opts: MetricsRecorderOptions) {
    this.filePath = join(opts.dir, 'metrics.jsonl');
  }

  async append(record: MetricRecord): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const line = JSON.stringify(record) + '\n';
    await appendFile(this.filePath, line, 'utf8');
  }

  async wrap<T>(wrapOpts: WrapOptions, fn: (ctx: WrapContext) => Promise<T>): Promise<T> {
    const start = Date.now();
    let reported: Usage | undefined;
    const ctx: WrapContext = {
      usage: (u) => {
        reported = u;
      },
    };

    try {
      const result = await fn(ctx);
      await this.recordSuccess(wrapOpts, reported, Date.now() - start);
      return result;
    } catch (err) {
      await this.recordSuccess(wrapOpts, reported, Date.now() - start, err);
      throw err;
    }
  }

  private async recordSuccess(
    wrapOpts: WrapOptions,
    usage: Usage | undefined,
    durationMs: number,
    err?: unknown,
  ): Promise<void> {
    const record: MetricRecord = {
      ts: new Date().toISOString(),
      projectId: this.opts.projectId,
      role: wrapOpts.role,
      model: usage?.model ?? wrapOpts.model ?? DEFAULT_MODEL,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
      durationMs,
      step: wrapOpts.step,
    };
    if (usage?.cacheReadTokens !== undefined) {
      record.cacheReadTokens = usage.cacheReadTokens;
    }
    if (usage?.cacheCreationTokens !== undefined) {
      record.cacheCreationTokens = usage.cacheCreationTokens;
    }
    try {
      await this.append(record);
    } catch (writeErr) {
      this.opts.logger.warn('metrics: failed to append record', {
        error: errMessage(writeErr),
        step: wrapOpts.step,
      });
    }
    if (err) {
      this.opts.logger.debug('metrics: wrapped fn threw', {
        step: wrapOpts.step,
        role: wrapOpts.role,
        error: errMessage(err),
      });
    }
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function isAgentRole(role: MetricRole): role is AgentRole {
  return (
    role === 'director' ||
    role === 'architect' ||
    role === 'programmer' ||
    role === 'tester' ||
    role === 'reviewer' ||
    role === 'evaluator'
  );
}
