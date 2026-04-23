/**
 * Port discovery for `uaf preview`.
 *
 * `findFreePort(preferred)` tries the preferred port first, then walks
 * upward (preferred+1, preferred+2, …) until it finds one that can be
 * bound. We bind, immediately close, and return the number — the dev
 * server will rebind it within a few hundred milliseconds. Race window
 * is real but tiny in single-user dev, and the fallback (server fails
 * with EADDRINUSE) is observable.
 *
 * `isPortFree(port)` is the primitive used internally; exposed for tests.
 */
import { createServer } from 'node:net';

export interface FindFreePortOptions {
  preferred: number;
  /** Maximum candidates to try (preferred .. preferred+max-1). Defaults to 50. */
  max?: number;
  /** Bind address; defaults to 127.0.0.1 (matches what dev servers prefer). */
  host?: string;
}

export async function findFreePort(opts: FindFreePortOptions): Promise<number> {
  const max = opts.max ?? 50;
  const host = opts.host ?? '127.0.0.1';
  for (let i = 0; i < max; i++) {
    const port = opts.preferred + i;
    if (await isPortFree(port, host)) return port;
  }
  throw new Error(
    `findFreePort: no free port in range ${opts.preferred}..${opts.preferred + max - 1}`,
  );
}

export function isPortFree(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const server = createServer();
    let settled = false;
    const done = (free: boolean): void => {
      if (settled) return;
      settled = true;
      server.removeAllListeners();
      try {
        server.close();
      } catch {
        /* ignore */
      }
      resolve(free);
    };
    server.once('error', () => done(false));
    server.once('listening', () => done(true));
    try {
      server.listen({ port, host, exclusive: true });
    } catch {
      done(false);
    }
  });
}
