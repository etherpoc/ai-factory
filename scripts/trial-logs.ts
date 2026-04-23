#!/usr/bin/env tsx
/**
 * Phase 7.8.10 — live verification of the file-routed logger + uaf logs.
 *
 * Does NOT call the real LLM. Instead:
 *   1. Creates a fake workspace at workspace/.trial-logs/<pid>/
 *   2. Uses createLogger({ filePath }) to write a realistic event stream
 *      (mimicking what create.ts emits: starting run, raw.usage, tool.call)
 *   3. Spawns `node bin/uaf.js logs <pid>` and prints the output
 *   4. Spawns the same with --tail / --filter / --raw / --cmd variants
 *
 * This exercises the exact production code paths (logger.ts → file →
 * logs.ts → stdout) without paying for LLM calls. For a real end-to-end
 * run with an actual `uaf create`, see scripts/e2e-phase7-8.ts.
 *
 * Usage:
 *   pnpm tsx scripts/trial-logs.ts
 */
import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from '../core/logger.js';

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const pid = `trial-logs-${new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14)}`;
  const workspaceDir = join(repoRoot, 'workspace', pid);
  await rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
  await mkdir(workspaceDir, { recursive: true });

  // Minimal state.json so findProject succeeds.
  const { writeFile } = await import('node:fs/promises');
  await writeFile(
    join(workspaceDir, 'state.json'),
    JSON.stringify({
      projectId: pid,
      recipeType: '2d-game',
      originalRequest: 'trial',
      status: 'completed',
      lastRunAt: new Date().toISOString(),
      iterations: [],
    }),
    'utf8',
  );

  // ---- Write to workspace/<pid>/logs/create.log via the production logger
  const logFile = join(workspaceDir, 'logs', 'create.log');
  const logger = createLogger({
    name: 'uaf.create',
    filePath: logFile,
    streamToConsole: false, // silent stderr — same as interactive default
  });
  logger.info('starting run', {
    request: 'trial',
    recipe: '2d-game',
    maxIter: 1,
    budgetUsd: 0.3,
  });
  logger.info('raw.usage', {
    role: 'interviewer',
    round: 0,
    model: 'claude-sonnet-4-6',
    usage: { input_tokens: 1234, output_tokens: 56 },
  });
  logger.info('tool.call', {
    role: 'interviewer',
    tool: 'ask_user',
    ok: true,
    durationMs: 18,
    args: '視点・ジャンルを教えてください。',
  });
  logger.info('tool.call', {
    role: 'interviewer',
    tool: 'write_file',
    ok: true,
    durationMs: 4,
    args: 'spec.md (2345 chars)',
  });
  logger.warn('workspace cleanup failed', { error: 'EBUSY: resource busy' });
  logger.error('run threw', { error: 'example budget exceeded' });

  // ---- Verify the file exists and has content
  const s = await stat(logFile);
  const raw = await readFile(logFile, 'utf8');
  const lineCount = raw.split('\n').filter(Boolean).length;

  process.stdout.write('\n========== file check ==========\n');
  process.stdout.write(`path        : ${logFile}\n`);
  process.stdout.write(`size        : ${s.size} bytes\n`);
  process.stdout.write(`lines       : ${lineCount}\n`);
  process.stdout.write(`first line  : ${raw.split('\n')[0]?.slice(0, 140)}…\n`);

  // ---- Invoke `uaf logs` via spawned subprocess (real CLI entry point)
  const runLogs = (args: string[]): string => {
    const r = spawnSync('node', ['bin/uaf.js', 'logs', pid, ...args], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: process.env,
    });
    if (r.status !== 0) {
      process.stderr.write(r.stderr + '\n');
      throw new Error(`uaf logs exited ${r.status}`);
    }
    return r.stdout;
  };

  process.stdout.write('\n========== uaf logs (default, pretty) ==========\n');
  process.stdout.write(runLogs([]));

  process.stdout.write('\n========== uaf logs --tail 3 ==========\n');
  process.stdout.write(runLogs(['--tail', '3']));

  process.stdout.write('\n========== uaf logs --filter error ==========\n');
  process.stdout.write(runLogs(['--filter', 'error']));

  process.stdout.write('\n========== uaf logs --raw --tail 1 ==========\n');
  process.stdout.write(runLogs(['--raw', '--tail', '1']));

  process.stdout.write('\n========== cleanup ==========\n');
  await rm(workspaceDir, { recursive: true, force: true });
  process.stdout.write(`removed ${workspaceDir}\n`);
}

main().catch((err) => {
  process.stderr.write(`trial-logs failed: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
