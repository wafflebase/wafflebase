import { test as base, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const AUTH_DIR = path.join(process.cwd(), 'playwright', '.auth');
const BACKEND_URL = process.env.WAFFLEBASE_E2E_BACKEND_URL ?? 'http://localhost:3000';

type Fixtures = Record<string, never>;
type WorkerFixtures = {
  workerStorageState: string;
  /**
   * Slug of the default workspace auto-created for the worker's test user.
   * Mirrors UserService.findOrCreateUser's slug rule:
   *   `${username}-s-workspace` (lowercased, non-alnum collapsed to dashes).
   * Specs should navigate directly to `/w/${workspaceSlug}` to skip
   * HomeOrRedirect's chain of fetches.
   */
  workspaceSlug: string;
};

export const test = base.extend<Fixtures, WorkerFixtures>({
  workerStorageState: [
    async ({ browser }, use, workerInfo) => {
      fs.mkdirSync(AUTH_DIR, { recursive: true });
      const file = path.join(AUTH_DIR, `worker-${workerInfo.workerIndex}.json`);

      if (!fs.existsSync(file)) {
        const ctx = await browser.newContext();
        const res = await ctx.request.post(`${BACKEND_URL}/test/auth/login`, {
          data: {
            username: `e2e-${workerInfo.workerIndex}`,
            email: `e2e-${workerInfo.workerIndex}@test.local`,
          },
        });
        if (!res.ok()) {
          throw new Error(
            `Test auth login failed (${res.status()}). ` +
              `Is the backend running with WAFFLEBASE_E2E_AUTH=1?`,
          );
        }
        await ctx.storageState({ path: file });
        await ctx.close();
      }

      await use(file);
    },
    { scope: 'worker' },
  ],

  // eslint-disable-next-line react-hooks/rules-of-hooks
  storageState: ({ workerStorageState }, use) => use(workerStorageState),

  workspaceSlug: [
    // No fixture deps; the destructure is required by Playwright's signature.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use, workerInfo) => {
      await use(`e2e-${workerInfo.workerIndex}-s-workspace`);
    },
    { scope: 'worker' },
  ],
});

export { expect };
