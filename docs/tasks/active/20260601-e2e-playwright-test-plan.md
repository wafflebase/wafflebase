# E2E Testing with @playwright/test — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up `@playwright/test` as the home for new behavioral e2e tests, with a test-only auth bypass on the backend, fixtures + template + docs on the frontend, lane + CI integration, and one proof-of-concept spec.

**Architecture:** A new env-gated `TestAuthController` issues real JWT cookies via the existing `AuthService.createTokens()` path. Playwright specs live under `packages/frontend/tests/e2e/`, import a shared `test`/`expect` from `tests/e2e/fixtures/index.ts`, and authenticate per-worker by hitting `/test/auth/login` once and caching `storageState`. Lane orchestrator `scripts/run-e2e-standalone.mjs` boots backend + frontend preview, waits on ports, runs the lane, and tears down. CI runs the lane in a `verify-e2e` job with Postgres + Yorkie services.

**Tech Stack:** `@playwright/test` 1.58.2 (pin to existing Playwright version), NestJS 11 (backend), Vite 5 (frontend dev/preview), GitHub Actions.

**Design doc:** [docs/design/e2e-testing.md](../../design/e2e-testing.md)

---

## File Structure

**Create:**
- `packages/backend/src/auth/test-auth.controller.ts` — env-gated controller
- `packages/backend/src/auth/test-auth.controller.spec.ts` — unit test (env gating, payload shape)
- `packages/backend/test/test-auth.e2e-spec.ts` — http-level e2e test (404 when unset, 200 + cookies when set)
- `packages/frontend/playwright.config.ts`
- `packages/frontend/tests/e2e/fixtures/auth.ts`
- `packages/frontend/tests/e2e/fixtures/index.ts`
- `packages/frontend/tests/e2e/specs/dashboard/create-slides-doc.spec.ts`
- `packages/frontend/tests/e2e/__template__.spec.ts`
- `packages/frontend/tests/e2e/README.md`
- `scripts/run-e2e-standalone.mjs`

**Modify:**
- `packages/backend/src/auth/auth.module.ts` — conditionally register `TestAuthController`
- `packages/backend/.eslintrc` / project test config — include the new `*.spec.ts`/`*.e2e-spec.ts`
- `packages/frontend/package.json` — add `@playwright/test` devDep + scripts
- `package.json` (root) — add `verify:e2e`, `verify:e2e:standalone`
- `.github/workflows/ci.yml` — add `verify-e2e` job
- `CLAUDE.md` — add `pnpm verify:e2e` to Commands
- `docs/design/README.md` — link `e2e-testing.md` in Common table
- `docs/design/harness-engineering.md` — list `verify:e2e` in lane table
- `packages/frontend/scripts/verify-interaction-browser.mjs` — add "do not add new scenarios" header
- `packages/frontend/scripts/verify-visual-browser.mjs` — add "do not add new scenarios" header
- `packages/frontend/.gitignore` — ignore `playwright/.auth/`, `playwright-report/`, `test-results/`

---

## Task 1: Backend — `TestAuthController` (env-gated)

**Files:**
- Create: `packages/backend/src/auth/test-auth.controller.ts`
- Create: `packages/backend/src/auth/test-auth.controller.spec.ts`
- Modify: `packages/backend/src/auth/auth.module.ts`

- [ ] **Step 1.1: Write the failing unit test**

Create `packages/backend/src/auth/test-auth.controller.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Response } from 'express';
import { AuthService } from './auth.service';
import { UserService } from '../user/user.service';
import { TestAuthController } from './test-auth.controller';

describe('TestAuthController', () => {
  let controller: TestAuthController;
  let userService: { findOrCreateUser: jest.Mock };
  let authService: AuthService;
  let res: Pick<Response, 'cookie' | 'json' | 'status'> & { cookie: jest.Mock; json: jest.Mock };

  beforeEach(async () => {
    userService = { findOrCreateUser: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      controllers: [TestAuthController],
      providers: [
        AuthService,
        JwtService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              ({
                JWT_SECRET: 'test-secret',
                JWT_ACCESS_EXPIRES_IN: '1h',
                JWT_REFRESH_EXPIRES_IN: '7d',
                NODE_ENV: 'test',
              })[key],
          },
        },
        { provide: UserService, useValue: userService },
      ],
    }).compile();

    controller = moduleRef.get(TestAuthController);
    authService = moduleRef.get(AuthService);
    res = {
      cookie: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      status: jest.fn().mockReturnThis() as never,
    };
  });

  it('creates or fetches the test user and sets both auth cookies', async () => {
    userService.findOrCreateUser.mockResolvedValue({
      id: 42,
      username: 'e2e-0',
      email: 'e2e-0@test.local',
      photo: null,
      authProvider: 'test',
    });

    await controller.login(
      { username: 'e2e-0', email: 'e2e-0@test.local' },
      res as unknown as Response,
    );

    expect(userService.findOrCreateUser).toHaveBeenCalledWith({
      authProvider: 'test',
      username: 'e2e-0',
      email: 'e2e-0@test.local',
      photo: null,
    });
    expect(res.cookie).toHaveBeenCalledWith(
      'wafflebase_session',
      expect.any(String),
      expect.objectContaining({ httpOnly: true, sameSite: 'lax' }),
    );
    expect(res.cookie).toHaveBeenCalledWith(
      'wafflebase_refresh',
      expect.any(String),
      expect.objectContaining({ httpOnly: true, sameSite: 'lax' }),
    );
    expect(res.json).toHaveBeenCalledWith({ ok: true, userId: 42 });
  });
});
```

- [ ] **Step 1.2: Run the test and confirm it fails (controller missing)**

Run: `pnpm --filter @wafflebase/backend test test-auth.controller`
Expected: FAIL — `Cannot find module './test-auth.controller'`.

- [ ] **Step 1.3: Implement `TestAuthController`**

Create `packages/backend/src/auth/test-auth.controller.ts`:

```ts
import {
  Body,
  Controller,
  HttpCode,
  Post,
  Res,
} from '@nestjs/common';
import { Response, CookieOptions } from 'express';
import { AuthService } from './auth.service';
import { UserService } from '../user/user.service';

const ACCESS_COOKIE_NAME = 'wafflebase_session';
const REFRESH_COOKIE_NAME = 'wafflebase_refresh';

type LoginBody = { username: string; email: string };

@Controller('test/auth')
export class TestAuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly userService: UserService,
  ) {}

  @Post('login')
  @HttpCode(200)
  async login(@Body() body: LoginBody, @Res() res: Response) {
    const user = await this.userService.findOrCreateUser({
      authProvider: 'test',
      username: body.username,
      email: body.email,
      photo: null,
    });

    if (!user) {
      throw new Error('Failed to create test user');
    }

    const tokens = this.authService.createTokens(user);
    const baseCookieOptions: CookieOptions = {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
    };

    res.cookie(ACCESS_COOKIE_NAME, tokens.accessToken, baseCookieOptions);
    res.cookie(REFRESH_COOKIE_NAME, tokens.refreshToken, baseCookieOptions);
    res.json({ ok: true, userId: user.id });
  }
}
```

- [ ] **Step 1.4: Run the test and confirm it passes**

Run: `pnpm --filter @wafflebase/backend test test-auth.controller`
Expected: PASS (1 spec).

- [ ] **Step 1.5: Gate registration in `AuthModule`**

Modify `packages/backend/src/auth/auth.module.ts` — replace the `controllers:` and `providers:` lines:

```ts
import { TestAuthController } from './test-auth.controller';

const TEST_AUTH_ENABLED = process.env.WAFFLEBASE_E2E_AUTH === '1';

@Module({
  imports: [
    ConfigModule.forRoot(),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: {
          expiresIn:
            (configService.get<string>('JWT_ACCESS_EXPIRES_IN') ?? '1h') as ms.StringValue,
        },
      }),
      inject: [ConfigService],
    }),
    UserModule,
  ],
  controllers: [
    AuthController,
    ...(TEST_AUTH_ENABLED ? [TestAuthController] : []),
  ],
  providers: [AuthService, CliAuthStore, GitHubAuthGuard, JwtStrategy, GitHubStrategy],
})
export class AuthModule {
  constructor() {
    if (TEST_AUTH_ENABLED) {
      console.warn('[test-auth] DEV-ONLY ROUTES ENABLED (WAFFLEBASE_E2E_AUTH=1)');
    }
  }
}
```

- [ ] **Step 1.6: Run backend test suite to confirm nothing else broke**

Run: `pnpm --filter @wafflebase/backend test`
Expected: All existing specs PASS plus the new one.

- [ ] **Step 1.7: Commit**

```bash
git add packages/backend/src/auth/test-auth.controller.ts \
        packages/backend/src/auth/test-auth.controller.spec.ts \
        packages/backend/src/auth/auth.module.ts
git commit -m "feat(backend): env-gated POST /test/auth/login for e2e

Adds TestAuthController, registered only when WAFFLEBASE_E2E_AUTH=1.
Issues real JWT cookies via the existing AuthService.createTokens()
path so the test session is indistinguishable from a GitHub OAuth one.
Production deploys never set the env, so the route is not mounted."
```

---

## Task 2: Backend — HTTP-level e2e for the env gate

**Files:**
- Create: `packages/backend/test/test-auth.e2e-spec.ts`

- [ ] **Step 2.1: Write the failing http e2e test**

Create `packages/backend/test/test-auth.e2e-spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from 'src/app.module';

describe('Test auth route (e2e)', () => {
  let app: INestApplication;

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it('returns 404 when WAFFLEBASE_E2E_AUTH is unset', async () => {
    delete process.env.WAFFLEBASE_E2E_AUTH;

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    await request(app.getHttpServer())
      .post('/test/auth/login')
      .send({ username: 'e2e-0', email: 'e2e-0@test.local' })
      .expect(404);
  });

  it('returns 200 + auth cookies when WAFFLEBASE_E2E_AUTH=1', async () => {
    process.env.WAFFLEBASE_E2E_AUTH = '1';

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const res = await request(app.getHttpServer())
      .post('/test/auth/login')
      .send({ username: 'e2e-0', email: 'e2e-0@test.local' })
      .expect(200);

    expect(res.body).toEqual({ ok: true, userId: expect.any(Number) });
    const cookies = (res.headers['set-cookie'] as unknown as string[]).join(';');
    expect(cookies).toContain('wafflebase_session=');
    expect(cookies).toContain('wafflebase_refresh=');

    delete process.env.WAFFLEBASE_E2E_AUTH;
  });
});
```

- [ ] **Step 2.2: Run the test and confirm it currently fails because module gating happens at construction, but the test reuses the same Node process**

Run: `pnpm --filter @wafflebase/backend test:e2e test-auth.e2e-spec`
Expected behavior: the first case must run BEFORE the second (Jest preserves declaration order within a file). If both fail with module-cache issues, switch to `jest.isolateModulesAsync` around the import of `AppModule` inside each `it()`. Adjust the test to:

```ts
it('returns 404 when WAFFLEBASE_E2E_AUTH is unset', async () => {
  delete process.env.WAFFLEBASE_E2E_AUTH;
  await jest.isolateModulesAsync(async () => {
    const { AppModule } = await import('src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    await request(app.getHttpServer())
      .post('/test/auth/login')
      .send({ username: 'e2e-0', email: 'e2e-0@test.local' })
      .expect(404);
  });
});
```

Apply the same `isolateModulesAsync` wrapper to the second case. Re-run.

- [ ] **Step 2.3: Confirm both cases pass**

Run: `pnpm --filter @wafflebase/backend test:e2e test-auth.e2e-spec`
Expected: PASS (2 specs).

- [ ] **Step 2.4: Commit**

```bash
git add packages/backend/test/test-auth.e2e-spec.ts
git commit -m "test(backend): http-level gate test for /test/auth/login

Confirms the route is 404 without WAFFLEBASE_E2E_AUTH=1 and 200 with
real session/refresh cookies when the env is set. Locks the security
contract in CI."
```

---

## Task 3: Frontend — Playwright deps, config, fixtures, template, README

**Files:**
- Modify: `packages/frontend/package.json`
- Create: `packages/frontend/playwright.config.ts`
- Create: `packages/frontend/tests/e2e/fixtures/auth.ts`
- Create: `packages/frontend/tests/e2e/fixtures/index.ts`
- Create: `packages/frontend/tests/e2e/__template__.spec.ts`
- Create: `packages/frontend/tests/e2e/README.md`
- Modify: `packages/frontend/.gitignore`

- [ ] **Step 3.1: Add `@playwright/test` devDep**

```bash
pnpm --filter @wafflebase/frontend add -D @playwright/test@1.58.2
```

Confirm `packages/frontend/package.json` `devDependencies` now lists `"@playwright/test": "1.58.2"`. The existing `playwright` entry at the same version stays — both packages share the same chromium download.

- [ ] **Step 3.2: Add frontend scripts**

Append to `packages/frontend/package.json` `"scripts"`:

```json
"e2e": "playwright test",
"e2e:ui": "playwright test --ui",
"e2e:debug": "playwright test --debug"
```

- [ ] **Step 3.3: Write `playwright.config.ts`**

Create `packages/frontend/playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.WAFFLEBASE_E2E_BASE_URL ?? 'http://localhost:5173';

export default defineConfig({
  testDir: 'tests/e2e/specs',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['html'], ['github']] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } },
  ],
  outputDir: 'test-results',
});
```

- [ ] **Step 3.4: Write `fixtures/auth.ts`**

Create `packages/frontend/tests/e2e/fixtures/auth.ts`:

```ts
import { test as base, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const AUTH_DIR = path.join(process.cwd(), 'playwright', '.auth');
const BACKEND_URL = process.env.WAFFLEBASE_E2E_BACKEND_URL ?? 'http://localhost:3000';

type Fixtures = Record<string, never>;
type WorkerFixtures = { workerStorageState: string };

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

  storageState: ({ workerStorageState }, use) => use(workerStorageState),
});

export { expect };
```

- [ ] **Step 3.5: Write `fixtures/index.ts`**

Create `packages/frontend/tests/e2e/fixtures/index.ts`:

```ts
export { test, expect } from './auth';
```

- [ ] **Step 3.6: Write `__template__.spec.ts`**

Create `packages/frontend/tests/e2e/__template__.spec.ts`:

```ts
// COPY THIS FILE. Replace the TODOs. Delete this header comment.
// Quick guide: ./README.md
//
// Pattern: Arrange / Act / Assert
//   Arrange — navigate and assert preconditions
//   Act     — perform the user-visible actions (click / fill / keyboard)
//   Assert  — check user-observable outcomes (URL, role, text, count)
//
// Selector priority:
//   1. getByRole(name)
//   2. getByText / getByLabel
//   3. data-testid (add to the component in the same PR if missing)
//   Avoid CSS class or structural selectors; they break on refactor.

import { test, expect } from '../fixtures';

test.describe('TODO: feature name', () => {
  test('TODO: behavior described in one sentence', async ({ page }) => {
    // Arrange
    await page.goto('/');

    // Act
    // TODO: user actions

    // Assert
    // TODO: user-observable outcomes
  });
});
```

- [ ] **Step 3.7: Write `tests/e2e/README.md`**

Create `packages/frontend/tests/e2e/README.md`:

````markdown
# E2E Tests (Playwright Test)

Behavioral end-to-end tests that drive the real app. For visual /
pixel-diff regression see `packages/frontend/scripts/verify-visual-browser.mjs`;
for jsdom unit tests see `packages/frontend/tests/`.

## Run

```bash
# One-shot (recommended): builds + boots backend + frontend, runs e2e, tears down.
docker compose up -d                    # postgres + yorkie (once per machine)
pnpm verify:e2e:standalone

# Or, against a running dev stack:
docker compose up -d
WAFFLEBASE_E2E_AUTH=1 pnpm dev          # in one terminal
pnpm verify:e2e                         # in another
```

## Debug

```bash
pnpm frontend e2e:ui                    # Playwright UI mode
pnpm frontend e2e:debug                 # Inspector
npx playwright show-trace test-results/<test>/trace.zip
```

## Add a test

```bash
cp packages/frontend/tests/e2e/__template__.spec.ts \
   packages/frontend/tests/e2e/specs/<area>/<name>.spec.ts
```

Then fill in the TODOs. Imports: `import { test, expect } from '../fixtures'`.

## Add a fixture

Drop a new file in `fixtures/`, then re-export `test` from
`fixtures/index.ts` extending the existing chain. Every spec imports from
`../fixtures` only — never from `@playwright/test` directly.

## Selectors

Prefer `getByRole` / `getByText` / `getByLabel`. Fall back to
`data-testid` only if no semantic selector works; add the `data-testid`
to the component in the same PR.
````

- [ ] **Step 3.8: Update frontend `.gitignore`**

Append to `packages/frontend/.gitignore`:

```
playwright/.auth/
playwright-report/
test-results/
```

- [ ] **Step 3.9: Verify Playwright config loads**

Run: `pnpm --filter @wafflebase/frontend exec playwright test --list`
Expected: lists 0 tests (no specs yet), no config errors.

- [ ] **Step 3.10: Commit**

```bash
git add packages/frontend/package.json packages/frontend/playwright.config.ts \
        packages/frontend/tests/e2e/ packages/frontend/.gitignore \
        pnpm-lock.yaml
git commit -m "chore(frontend): @playwright/test config, fixtures, template

Auth fixture POSTs /test/auth/login once per worker and caches
storageState. Template + README give a copy-paste path for new specs.
No spec files yet — the POC lands in the next commit."
```

---

## Task 4: Frontend — POC spec + missing `data-testid`s

**Files:**
- Create: `packages/frontend/tests/e2e/specs/dashboard/create-slides-doc.spec.ts`
- Modify: dashboard list component (add `data-testid="document-row"` to each row)
- Modify: slides editor root component (add `data-testid="slides-editor"`)

- [ ] **Step 4.1: Locate the dashboard list and slides editor root**

Run: `grep -rn "My Documents\|document-list\|DocumentList" packages/frontend/src/ | head`
Run: `grep -rn "SlidesEditor\|slides-editor\|presentation-route" packages/frontend/src/ | head`

Identify the React file rendering each document row in the dashboard and the file rendering the slides editor when navigating to `/document/:id` (or whichever route serves a slides doc — check `App.tsx` / router).

- [ ] **Step 4.2: Write the failing spec**

Create `packages/frontend/tests/e2e/specs/dashboard/create-slides-doc.spec.ts`:

```ts
import { test, expect } from '../../fixtures';

test.describe('Dashboard: create slides document', () => {
  test('creates a new slides document and lists it', async ({ page }) => {
    await page.goto('/');

    await expect(
      page.getByRole('heading', { name: /my documents/i }),
    ).toBeVisible();

    const docsBefore = await page.getByTestId('document-row').count();

    await page.getByRole('button', { name: /new slides/i }).click();

    await expect(page).toHaveURL(/\/document\/[a-z0-9-]+/);
    await expect(page.getByTestId('slides-editor')).toBeVisible();

    await page.goto('/');
    const docsAfter = await page.getByTestId('document-row').count();
    expect(docsAfter).toBe(docsBefore + 1);
  });
});
```

- [ ] **Step 4.3: Run the spec — it will fail until selectors exist**

```bash
docker compose up -d
WAFFLEBASE_E2E_AUTH=1 pnpm dev            # in one terminal
pnpm --filter @wafflebase/frontend e2e specs/dashboard/create-slides-doc.spec.ts
```

Expected: FAIL, almost certainly on `getByTestId('document-row')` or `getByRole('button', { name: /new slides/i })`. Inspect the trace (`test-results/.../trace.zip`) to see where.

- [ ] **Step 4.4: Add `data-testid="document-row"` to the dashboard row component**

In the dashboard file located in Step 4.1, find the JSX element representing one document row (the `<li>` / `<Link>` / `<tr>` wrapper) and add `data-testid="document-row"` to it.

- [ ] **Step 4.5: Add `data-testid="slides-editor"` to the slides editor root**

Find the top-level element of the slides editor component (the wrapper around the canvas + toolbar) and add `data-testid="slides-editor"`.

- [ ] **Step 4.6: Confirm the "New Slides" button has an accessible name**

Find the New Slides creation button on the dashboard. If it uses an icon only, add `aria-label="New slides"`. If it already has visible text "New slides" or "New Presentation", update the spec's name regex (`/new slides/i`) to match. Prefer the accessible-name path.

- [ ] **Step 4.7: Re-run the spec**

```bash
pnpm --filter @wafflebase/frontend e2e specs/dashboard/create-slides-doc.spec.ts
```

Expected: PASS (1 spec).

- [ ] **Step 4.8: Force a failure to validate trace output**

Temporarily change the assertion to `expect(docsAfter).toBe(docsBefore + 99)`. Re-run. Confirm `test-results/<test>/trace.zip` is produced and `npx playwright show-trace test-results/<test>/trace.zip` opens. Revert the assertion.

- [ ] **Step 4.9: Commit**

```bash
git add packages/frontend/tests/e2e/specs packages/frontend/src
git commit -m "feat(frontend): e2e POC — create slides document from dashboard

First Playwright Test spec exercises the real /dashboard → click 'New
Slides' → /document/:id flow against a live backend. Adds the minimum
data-testid hooks needed for stable selection."
```

---

## Task 5: Lane scripts — `verify:e2e` + `verify:e2e:standalone`

**Files:**
- Modify: `package.json` (root)
- Create: `scripts/run-e2e-standalone.mjs`
- Modify: `CLAUDE.md`

- [ ] **Step 5.1: Add the root scripts**

Edit root `package.json` `"scripts"`:

```json
"verify:e2e": "pnpm --filter @wafflebase/frontend e2e",
"verify:e2e:standalone": "node ./scripts/run-e2e-standalone.mjs"
```

Place them adjacent to `verify:integration` and `verify:browser:docker`.

- [ ] **Step 5.2: Write the standalone orchestrator**

Create `scripts/run-e2e-standalone.mjs`:

```js
#!/usr/bin/env node
// One-shot e2e runner: boots backend + frontend preview, waits on ports,
// runs `pnpm verify:e2e`, tears down. Designed for CI and clean local runs.

import { spawn } from 'node:child_process';
import net from 'node:net';
import process from 'node:process';

const BACKEND_PORT = Number(process.env.PORT ?? 3000);
const FRONTEND_PORT = 5173;
const WAIT_TIMEOUT_MS = 60_000;
const WAIT_INTERVAL_MS = 500;

const children = [];

function startChild(cmd, args, env = {}) {
  const child = spawn(cmd, args, {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, ...env },
    shell: false,
  });
  children.push(child);
  return child;
}

function waitForPort(port) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + WAIT_TIMEOUT_MS;
    const tick = () => {
      const socket = net.connect(port, '127.0.0.1');
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() > deadline) {
          reject(new Error(`Timed out waiting for :${port}`));
        } else {
          setTimeout(tick, WAIT_INTERVAL_MS);
        }
      });
    };
    tick();
  });
}

function preflightHints() {
  const hints = [];
  if (!process.env.DATABASE_URL && !process.env.SKIP_E2E_PREFLIGHT) {
    hints.push(
      "  • DATABASE_URL is unset — did you run `docker compose up -d` and source the backend .env?",
    );
  }
  if (hints.length > 0) {
    console.warn('[verify:e2e:standalone] preflight hints:');
    for (const h of hints) console.warn(h);
  }
}

function cleanup() {
  for (const c of children) {
    if (!c.killed) c.kill('SIGTERM');
  }
}

process.on('exit', cleanup);
process.on('SIGINT', () => {
  cleanup();
  process.exit(130);
});
process.on('SIGTERM', () => {
  cleanup();
  process.exit(143);
});

(async () => {
  preflightHints();

  console.log('[verify:e2e:standalone] starting backend (WAFFLEBASE_E2E_AUTH=1)');
  startChild('pnpm', ['--filter', '@wafflebase/backend', 'start:dev'], {
    WAFFLEBASE_E2E_AUTH: '1',
  });

  console.log('[verify:e2e:standalone] starting frontend dev server');
  startChild('pnpm', ['--filter', '@wafflebase/frontend', 'dev']);

  try {
    await Promise.all([waitForPort(BACKEND_PORT), waitForPort(FRONTEND_PORT)]);
  } catch (err) {
    console.error(`[verify:e2e:standalone] ${err.message}`);
    console.error(
      'Hints: `docker compose up -d` for Postgres + Yorkie; check backend logs for missing env.',
    );
    cleanup();
    process.exit(1);
  }

  console.log('[verify:e2e:standalone] running playwright');
  const playwright = startChild('pnpm', ['verify:e2e']);
  playwright.on('exit', (code) => {
    cleanup();
    process.exit(code ?? 1);
  });
})();
```

Make it executable:

```bash
chmod +x scripts/run-e2e-standalone.mjs
```

- [ ] **Step 5.3: Add `pnpm verify:e2e` to `CLAUDE.md` Commands table**

In `CLAUDE.md`, under the `## Commands` block, add a row after `pnpm verify:integration`:

```text
pnpm verify:e2e                     # Playwright behavioral e2e (needs backend with WAFFLEBASE_E2E_AUTH=1)
pnpm verify:e2e:standalone          # One-shot: boots backend + frontend + runs e2e
```

- [ ] **Step 5.4: Smoke-test the lane locally**

```bash
docker compose up -d
WAFFLEBASE_E2E_AUTH=1 pnpm dev      # in one terminal
pnpm verify:e2e                     # in another
```

Expected: POC spec passes.

Then test the standalone variant from a clean state (kill `pnpm dev` first):

```bash
pnpm verify:e2e:standalone
```

Expected: backend + frontend boot, spec passes, processes terminate cleanly.

- [ ] **Step 5.5: Commit**

```bash
git add package.json scripts/run-e2e-standalone.mjs CLAUDE.md
git commit -m "feat(harness): verify:e2e + verify:e2e:standalone lanes

verify:e2e runs Playwright against an already-running stack.
verify:e2e:standalone boots backend (WAFFLEBASE_E2E_AUTH=1) and
frontend, waits on ports, runs the lane, tears down."
```

---

## Task 6: CI — `verify-e2e` job

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 6.1: Add the `verify-e2e` job alongside `verify-integration`**

Append a new job after `verify-integration` in `.github/workflows/ci.yml`. Mirror its Postgres + Yorkie setup; add a Playwright browser install and run the lane via the standalone script.

```yaml
  verify-e2e:
    runs-on: ubuntu-latest
    needs: verify-self
    env:
      DATABASE_URL: postgresql://wafflebase:wafflebase@localhost:5432/wafflebase
      DATASOURCE_ENCRYPTION_KEY: 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
      RUN_DB_INTEGRATION_TESTS: "true"
      RUN_YORKIE_INTEGRATION_TESTS: "true"
      YORKIE_RPC_ADDR: http://localhost:8080
      WAFFLEBASE_E2E_AUTH: "1"
      JWT_SECRET: ci-e2e-jwt-secret
      FRONTEND_URL: http://localhost:5173
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: wafflebase
          POSTGRES_PASSWORD: wafflebase
          POSTGRES_DB: wafflebase
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U wafflebase -d wafflebase"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    strategy:
      matrix:
        node-version: [22.x]
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - name: Use Node.js ${{ matrix.node-version }}
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: "pnpm"
      - name: Install Dependencies
        run: pnpm install --frozen-lockfile

      - name: Build workspace packages
        run: |
          pnpm tokens build
          pnpm --filter @wafflebase/docs build
          pnpm slides build
          pnpm sheets build

      - name: Install Playwright browser (chromium only)
        run: pnpm --filter @wafflebase/frontend exec playwright install chromium --with-deps

      - name: Start Yorkie server
        run: |
          docker run -d --name yorkie \
            -p 8080:8080 -p 8081:8081 \
            yorkieteam/yorkie:latest server --pprof-enabled

      - name: Wait for Yorkie
        run: |
          for i in $(seq 1 30); do
            if nc -z localhost 8080; then exit 0; fi
            sleep 1
          done
          docker logs yorkie || true
          exit 1

      - name: Apply database migrations
        run: pnpm --filter @wafflebase/backend exec prisma migrate deploy

      - name: Run e2e lane (standalone)
        id: e2e
        run: pnpm verify:e2e:standalone

      - name: Upload Playwright report
        if: failure() && steps.e2e.outcome == 'failure'
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: packages/frontend/playwright-report
          retention-days: 14

      - name: Upload Playwright traces
        if: failure() && steps.e2e.outcome == 'failure'
        uses: actions/upload-artifact@v4
        with:
          name: playwright-traces
          path: packages/frontend/test-results
          retention-days: 14

      - name: Yorkie logs on failure
        if: failure()
        run: docker logs yorkie
```

- [ ] **Step 6.2: Validate workflow syntax locally**

Run: `act -W .github/workflows/ci.yml --list 2>/dev/null || yamllint .github/workflows/ci.yml`
(If neither tool is installed, skip — the next push will surface any YAML error.)

- [ ] **Step 6.3: Commit and push to a feature branch**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: verify-e2e job with Postgres + Yorkie + Playwright

Mirrors verify-integration's service setup, installs chromium with
deps, runs verify:e2e:standalone, and uploads playwright-report and
test-results on failure (14-day retention)."
git push -u origin <feature-branch>
```

- [ ] **Step 6.4: Observe the run on GitHub**

Expected: `verify-e2e` job goes green. If red, download the artifacts and run `npx playwright show-trace <trace.zip>` locally to diagnose. Iterate until green.

---

## Task 7: Docs — design cross-links + legacy headers

**Files:**
- Modify: `docs/design/README.md`
- Modify: `docs/design/harness-engineering.md`
- Modify: `packages/frontend/scripts/verify-visual-browser.mjs`
- Modify: `packages/frontend/scripts/verify-interaction-browser.mjs`

- [ ] **Step 7.1: Link the new design doc from `docs/design/README.md`**

In the "Common" table, insert a row between `harness-engineering.md` and `homepage.md`:

```markdown
| [e2e-testing.md](e2e-testing.md)                       | E2E behavioral testing — @playwright/test, test-auth bypass, fixtures, POC, lane + CI integration |
```

- [ ] **Step 7.2: Mention `verify:e2e` in `harness-engineering.md` lane list**

Add a row under the existing lane table (search for `verify:browser:docker`):

```markdown
| `pnpm verify:e2e`            | **browser**       | Behavioral end-to-end (real backend + frontend, Playwright Test)         |
```

(Match the column count of the existing table — adjust if needed.)

- [ ] **Step 7.3: Add "do not add new scenarios" headers to legacy verifiers**

Prepend to `packages/frontend/scripts/verify-visual-browser.mjs`:

```js
// LEGACY VERIFIER — visual baseline only.
// Do not add new scenarios here. New e2e tests go in
// `packages/frontend/tests/e2e/` (Playwright Test).
// See docs/design/e2e-testing.md.
```

Prepend the equivalent header to `verify-interaction-browser.mjs`:

```js
// LEGACY VERIFIER — interaction regression only (cell input / formula /
// scroll). Do not add new scenarios here. New e2e tests go in
// `packages/frontend/tests/e2e/` (Playwright Test).
// See docs/design/e2e-testing.md.
```

(Place them after any existing shebang/use-strict lines.)

- [ ] **Step 7.4: Commit**

```bash
git add docs/design/README.md docs/design/harness-engineering.md \
        packages/frontend/scripts/verify-visual-browser.mjs \
        packages/frontend/scripts/verify-interaction-browser.mjs
git commit -m "docs: link e2e-testing design + mark legacy verifiers

Adds the new design doc to the design index, lists verify:e2e in the
harness-engineering lane table, and marks the legacy .mjs verifiers as
closed to new scenarios. Migration plan is in the design doc."
```

---

## Task 8: Final verification + self-review + PR

- [ ] **Step 8.1: Full local verification**

```bash
pnpm verify:fast                        # arch + unit tests
pnpm verify:e2e:standalone              # new lane end-to-end
```

Both green.

- [ ] **Step 8.2: Production-safety check**

```bash
WAFFLEBASE_E2E_AUTH= NODE_ENV=production pnpm --filter @wafflebase/backend build
NODE_ENV=production pnpm --filter @wafflebase/backend start &
BACKEND_PID=$!
sleep 3
curl -s -o /dev/null -w '%{http_code}\n' \
  -X POST http://localhost:3000/test/auth/login \
  -H 'content-type: application/json' \
  -d '{"username":"x","email":"x@x"}'
kill $BACKEND_PID
```

Expected: `404`.

- [ ] **Step 8.3: Rebase on `origin/main`**

```bash
git fetch && git rebase origin/main
```

Resolve any conflicts. Re-run `pnpm verify:fast`.

- [ ] **Step 8.4: Self code-review**

Run the `/code-review` skill (or `superpowers:requesting-code-review`) over the full branch diff. Address blocking findings, note non-blocking as known limitations on the PR body.

- [ ] **Step 8.5: Capture lessons**

Create `docs/tasks/active/20260601-e2e-playwright-test-lessons.md` summarizing any surprises (CI timing, fixture quirks, selector additions, env-gating gotchas) — at least one entry; if there were no surprises, write "No surprises" and one sentence on why.

- [ ] **Step 8.6: Archive task pair after merge**

Once the PR is merged:

```bash
pnpm tasks:archive && pnpm tasks:index
git add docs/tasks tasks
git commit -m "chore(tasks): archive e2e-playwright-test"
git push
```

- [ ] **Step 8.7: Open PR**

Title (≤70 chars): `feat: introduce @playwright/test for behavioral e2e`

Body:

```markdown
## Summary
- Test-only `/test/auth/login` route, env-gated on `WAFFLEBASE_E2E_AUTH=1`
- `@playwright/test` scaffold under `packages/frontend/tests/e2e/` with
  fixtures, template, README
- POC spec: create a slides document from the dashboard, against a live
  backend
- `verify:e2e` + `verify:e2e:standalone` lanes; CI `verify-e2e` job
- Design doc and cross-links; legacy `.mjs` verifiers marked closed

## Test plan
- [ ] `pnpm verify:fast` green
- [ ] `pnpm verify:e2e:standalone` green from clean state
- [ ] Backend prod build returns 404 for `/test/auth/login` with the env unset
- [ ] CI `verify-e2e` job green
- [ ] Induced failure produces `trace.zip` artifact

Design: docs/design/e2e-testing.md
```

---

## Self-Review

**Spec coverage check** — every section of the design doc maps to a task:

| Spec section | Task |
|---|---|
| Test-only auth bypass | Task 1, 2 |
| Architecture overview / directory layout | Task 3 (config + fixtures + template + README) |
| Lane / CI integration | Task 5, 6 |
| Playwright config | Task 3.3 |
| Proof-of-concept spec | Task 4 |
| Selector policy | Task 4.4–4.6 + README (Task 3.7) |
| Agent-facing surface | Task 3.7 (README), Task 5.3 (CLAUDE.md), Task 7 (design index + harness doc) |
| Coexistence rules | Task 7.3 (legacy verifier headers) |
| Risks — production leak | Task 1.5 (gating), Task 2 (e2e gate test), Task 8.2 (prod-safety check) |
| Risks — flaky tests | Task 3.3 (retries: 2 in CI) |
| Risks — workflow drift | Task 7.3 (legacy headers) |
| Non-goals (visual migration) | Documented in design doc; nothing in plan |

No gaps.

**Placeholder scan** — no `TBD`, `TODO`, or "handle edge cases" steps. Every code-changing step shows the code or the exact lines to add.

**Type consistency check** — `AuthService.createTokens(user) => { accessToken, refreshToken }` is the API used in both Task 1.3 and the existing controller; `UserService.findOrCreateUser({ authProvider, username, email, photo })` matches the existing call site in `auth.controller.ts`. Cookie names (`wafflebase_session`, `wafflebase_refresh`) match production. Fixture's `workerStorageState` worker fixture wires into Playwright's `storageState` via `({ workerStorageState }, use) => use(workerStorageState)`, consistent end-to-end.
