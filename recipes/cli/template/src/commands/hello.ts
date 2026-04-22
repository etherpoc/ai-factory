import type { Command } from 'commander';
import chalk from 'chalk';

interface HelloOptions {
  name: string;
}

export function handleHello(options: HelloOptions): void {
  console.log(chalk.green(`Hello, ${options.name}!`));
}

export function registerHello(program: Command): void {
  program
    .command('hello')
    .description('Print a greeting — scaffold stub, replace via spec.md')
    .option('-n, --name <name>', 'name to greet', 'World')
    .action((opts: HelloOptions) => {
      handleHello(opts);
    });
}
