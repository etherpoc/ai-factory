#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { Command } from 'commander';
import chalk from 'chalk';
import { registerCommands } from './commands/index.js';

process.on('unhandledRejection', (reason) => {
  console.error(chalk.red('Unhandled error:'), reason);
  process.exit(1);
});

export const program = new Command();

program
  .name('cli-app')
  .description('A CLI tool — replace this description via spec.md')
  .version('0.1.0');

registerCommands(program);

// bin として直接実行された場合のみ parse する（テスト時の二重実行を防ぐ）
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  program.parseAsync(process.argv).catch((err: unknown) => {
    console.error(chalk.red('Fatal:'), err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
