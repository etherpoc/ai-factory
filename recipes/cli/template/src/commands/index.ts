import type { Command } from 'commander';
import { registerHello } from './hello.js';

/**
 * program にすべてのサブコマンドを登録する。
 * Programmer はここに `register<Name>(program)` を追記していく。
 */
export function registerCommands(program: Command): void {
  registerHello(program);
}
