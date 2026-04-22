/**
 * Launch an editor or browser on a path. Used by `uaf open` and
 * `uaf config edit`.
 */
import { spawn } from 'node:child_process';
import { UafError } from '../ui/errors.js';

/**
 * Resolve the editor command, respecting:
 *   1. explicit argument (`--editor ...`)
 *   2. user config (cfg.editor from cli/config/loader.ts, passed in)
 *   3. $EDITOR / $VISUAL env vars
 *   4. a platform default (`code` on any, then `vi` on unix, `notepad` on win)
 */
export function resolveEditor(explicit?: string, configured?: string): string {
  if (explicit && explicit.trim().length > 0) return explicit;
  if (configured && configured.trim().length > 0) return configured;
  const env = process.env.VISUAL ?? process.env.EDITOR;
  if (env && env.trim().length > 0) return env;
  // Reasonable cross-platform default.
  return process.platform === 'win32' ? 'notepad' : 'vi';
}

/**
 * Spawn `<cmd> <path>` with stdio inherited. Resolves once the process exits
 * cleanly; rejects with UafError on non-zero.
 */
export async function openInEditor(cmd: string, path: string): Promise<void> {
  return new Promise((resolveFn, reject) => {
    // On Windows, shell: true lets us resolve `code` / `notepad` from PATH
    // without requiring .cmd suffixes.
    const child = spawn(cmd, [path], {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    child.on('error', (err) =>
      reject(
        new UafError(`failed to launch editor: ${cmd}`, {
          code: 'RUNTIME_FAILURE',
          cause: err,
          hint: `Check that "${cmd}" is on PATH, or set --editor / $EDITOR explicitly.`,
        }),
      ),
    );
    child.on('exit', (code) => {
      if (code === 0 || code === null) resolveFn();
      else
        reject(
          new UafError(`editor exited with code ${code}`, {
            code: 'RUNTIME_FAILURE',
          }),
        );
    });
  });
}

/** Open a URL in the platform's default browser. */
export async function openInBrowser(target: string): Promise<void> {
  const cmd =
    process.platform === 'win32'
      ? 'start'
      : process.platform === 'darwin'
        ? 'open'
        : 'xdg-open';
  return new Promise((resolveFn, reject) => {
    const args = process.platform === 'win32' ? ['', target] : [target];
    const child = spawn(cmd, args, {
      stdio: 'ignore',
      shell: process.platform === 'win32',
      detached: true,
    });
    child.on('error', (err) =>
      reject(new UafError(`failed to open browser: ${cmd}`, { code: 'RUNTIME_FAILURE', cause: err })),
    );
    child.unref();
    // Don't wait for the browser to close; resolve immediately.
    resolveFn();
  });
}
