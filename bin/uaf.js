#!/usr/bin/env node
/**
 * uaf launcher.
 *
 * The real CLI lives in TypeScript at `cli/index.ts`. This launcher uses
 * tsx 4's programmatic API (`tsx/esm/api`) to install the TS loader so we can
 * import TS directly without a build step.
 *
 * After `pnpm link --global`, the shim pnpm generates for this bin still
 * resolves `tsx` from the package's own `node_modules`.
 */
import { register } from 'tsx/esm/api';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, '..');

register();

const { main } = await import(pathToFileURL(join(pkgRoot, 'cli', 'index.ts')).href);
const code = await main(process.argv);
process.exit(code);
