import fs from 'node:fs';
import path from 'node:path';

/**
 * Wipe the per-worker auth cache at the start of every run.
 *
 * The auth fixture (fixtures/auth.ts) caches storageState to
 * playwright/.auth/worker-<N>.json per worker. Without this wipe a
 * stale cookie (post-expiry, after a JWT_SECRET rotation, after a
 * DB wipe between local runs) would silently poison every subsequent
 * spec until the operator remembered to delete the cache by hand.
 *
 * Running this once per Playwright invocation costs ~1ms and removes
 * a class of opaque failures.
 */
export default async function globalSetup(): Promise<void> {
  const authDir = path.join(process.cwd(), 'playwright', '.auth');
  if (fs.existsSync(authDir)) {
    fs.rmSync(authDir, { recursive: true, force: true });
  }
}
