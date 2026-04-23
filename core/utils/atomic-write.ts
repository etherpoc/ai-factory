/**
 * Atomic file write — write to a sibling temp file, fsync the data, then
 * `rename()` into place. On POSIX and on NTFS, `rename()` within the same
 * directory is atomic: any reader either sees the old file or the new file,
 * never a half-written one.
 *
 * Used by Phase 7.8 for state.json checkpoints. R12 (常時再開可能) requires
 * that a crash mid-write never leaves state.json corrupt — otherwise
 * `uaf resume` could lose the entire project.
 */
import { open, rename, unlink } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';

/**
 * Write `data` to `path` atomically. Throws on failure; on success, `path`
 * either had its old contents or has the new contents.
 *
 * Implementation notes:
 *  - The temp file lives in the same directory as `path` so `rename()`
 *    stays on one filesystem (cross-FS rename is not atomic).
 *  - Temp filename includes pid + timestamp + a counter so two concurrent
 *    callers in the same process can't collide.
 *  - We `fsync` the file before rename — without this, a crash between
 *    write() and rename() can leave the rename happening on uncommitted
 *    data, which produces a zero-byte file after reboot.
 */
let counter = 0;
export async function atomicWrite(path: string, data: string | Uint8Array): Promise<void> {
  const dir = dirname(path);
  const base = basename(path);
  counter = (counter + 1) % 1_000_000;
  const tmpPath = join(dir, `.${base}.tmp-${process.pid}-${Date.now()}-${counter}`);

  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(tmpPath, 'w');
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await renameWithRetry(tmpPath, path);
  } catch (err) {
    if (handle) {
      await handle.close().catch(() => undefined);
    }
    await unlink(tmpPath).catch(() => undefined);
    throw err;
  }
}

/**
 * Windows-friendly rename. NTFS may return EPERM / EBUSY / EACCES when the
 * destination is briefly held open by another process (typical for
 * concurrent atomicWrite() calls — virus scanners, indexers, or another
 * Node thread mid-rename). Retry a handful of times with exponential
 * backoff before giving up. POSIX rename is fully atomic and never sees
 * these codes, so this loop is a no-op there.
 */
async function renameWithRetry(from: string, to: string): Promise<void> {
  const maxAttempts = 8;
  let lastErr: NodeJS.ErrnoException | undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code !== 'EPERM' && e.code !== 'EBUSY' && e.code !== 'EACCES') {
        throw err;
      }
      lastErr = e;
      // 5, 10, 20, 40, 80, 160, 320, 640 ms backoff (~1.3s total worst case)
      await new Promise((r) => setTimeout(r, 5 * 2 ** attempt));
    }
  }
  throw lastErr;
}
