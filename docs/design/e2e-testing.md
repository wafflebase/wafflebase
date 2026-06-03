---
title: e2e-testing
target-version: 0.5.0
---

<!-- Make sure to append document link in design README.md after creating the document. -->

# E2E Testing with @playwright/test

## Summary

Introduce `@playwright/test` as a first-class end-to-end testing system that
targets real application routes (login → dashboard → editor) and runs against
a full local stack (Postgres + Yorkie + backend + frontend). The new system
coexists with the existing visual-regression baselines
(`packages/frontend/scripts/verify-visual-browser.mjs`) and interaction-regression scripts
(`packages/frontend/scripts/verify-interaction-browser.mjs`), and is intended to be the default
home for **new** behavioral e2e tests — particularly those that an AI agent
exercises via the Puppeteer MCP during a smoke step and then wants to codify
as a permanent regression.

The current browser-test infrastructure uses Playwright's API directly from
custom Node scripts. It works for the 43 visual baselines but creates
friction for adding behavioral tests: scenarios are hardcoded, lockstep
edits across two files are required to add one, and there are no fixtures,
traces, or standard reporters. Behavioral coverage is limited to three
hardcoded scenarios (cell input, formula, scroll), which means agent-driven
smoke checks rarely become permanent tests.

### Goals

- A single, well-known place (`packages/frontend/tests/e2e/`) where any new
  behavioral e2e test lives.
- A copy-paste template (`packages/frontend/tests/e2e/__template__.spec.ts`) that an agent can fill in
  during a "promote my smoke check" step.
- Test-only auth bypass that lets specs reach authenticated routes in under
  one second per worker, without touching GitHub OAuth.
- Standard Playwright fixtures (`auth`, `freshDoc`) discoverable through a
  single `packages/frontend/tests/e2e/fixtures/index.ts` re-export.
- A `verify:e2e` lane wired into `harness.config.json` and CI, with
  failure-only HTML report + trace artifacts retained for 14 days.
- A first proof-of-concept scenario shipped together with the infrastructure
  so the pattern is demonstrable, not aspirational.

### Non-Goals

- **Migrating existing visual baselines** (43 PNGs under
  `tests/visual/baselines/`) to `toHaveScreenshot()`. The
  bit-perfect-vs-threshold semantics differ, font-rendering Docker
  consistency must be re-validated, and the migration is large enough to
  warrant its own design pass. **This decision is explicitly deferred and
  revisited only after the new system has been stable for at least one
  release cycle.** Visual regressions continue to use
  `verify:browser:docker` indefinitely until that decision is made.
- **Migrating existing interaction scripts** (cell input / formula / scroll)
  in the first PR. These are moved opportunistically in later PRs and the
  old verifier is removed only once its scenario count reaches zero.
- **Replacing vitest unit/component tests.** Anything that runs in jsdom
  stays in jsdom.
- **Expanding e2e to other packages** (`sheets`, `docs`, `slides`,
  `backend`, `cli`). First cycle is `frontend` only.
- **Real GitHub OAuth in CI.** External-service dependencies stay out of
  the e2e lane.

## Proposal Details

### Architecture overview

```
packages/frontend/
├── playwright.config.ts                # config: projects, reporter, trace, baseURL
├── tests/
│   ├── e2e/                            # new @playwright/test home
│   │   ├── fixtures/
│   │   │   ├── auth.ts                 # storageState + test-user fixture
│   │   │   ├── doc.ts                  # freshDoc seed + teardown (PR2+)
│   │   │   └── index.ts                # re-export of `test`, `expect`
│   │   ├── support/
│   │   │   └── pages/                  # optional page-object helpers
│   │   ├── specs/
│   │   │   └── dashboard/
│   │   │       └── create-slides-doc.spec.ts  # POC
│   │   ├── __template__.spec.ts        # copy-this-file template
│   │   └── README.md                   # quick-start for humans + agents
│   ├── visual/                         # existing baselines (untouched)
│   └── …                               # existing vitest files (untouched)
└── scripts/
    ├── verify-visual-browser.mjs       # legacy, unchanged
    └── verify-interaction-browser.mjs  # legacy, unchanged
```

Rationale:

- One canonical home (`tests/e2e/`) so the answer to "where does a new e2e
  test go?" is fixed.
- `packages/frontend/tests/e2e/fixtures/index.ts` exposes an extended `test` plus `expect`. Every spec
  imports from the same path, which makes the pattern easy for an agent to
  reproduce.
- Legacy scripts continue to power `verify:browser:docker` so visual
  coverage does not regress.

### Test-only auth bypass

A new `TestAuthController` is added under `packages/backend/src/auth/`,
gated on `WAFFLEBASE_E2E_AUTH === '1'`. The controller exposes a single
endpoint:

```
POST /test/auth/login
body: { username: string, email: string }
→ idempotent findOrCreateUser({ authProvider: 'test', ... })
→ sets wafflebase_session + wafflebase_refresh cookies (same shape as
   production)
→ returns { ok: true, userId }
```

Guard rails:

- The controller is registered inside `AuthModule` only when the env var is
  set at module-construction time. In production deploys (where the env
  is never set) the route is not registered, so requests to
  `/test/auth/login` return 404.
- Backend logs `[test-auth] DEV-ONLY ROUTES ENABLED` on startup when the
  flag is on. Reviewers grepping for the controller name find a clear
  marker.
- Token signing reuses `AuthService.signTokens()` — the JWT shape and
  cookie attributes match real OAuth login.
- Deployment hardening: the `WAFFLEBASE_E2E_AUTH` env var is never set in
  any production Dockerfile or deploy manifest. README + design doc both
  state this explicitly.

The Playwright auth fixture (`packages/frontend/tests/e2e/fixtures/auth.ts`) uses a
per-worker `storageState` cache. On first use per worker it POSTs to
`/test/auth/login` with `username = "e2e-${workerIndex}"`, persists the
resulting cookies to `playwright/.auth/worker-${workerIndex}.json`, and
re-uses that file for the rest of the worker's lifetime. Specs simply
import `test` and `expect` from `../fixtures` — no per-test login cost
visible to the test author.

### Lane / CI integration

Lane definitions:

| Command | Purpose | Browser | Requires |
|---|---|---|---|
| `pnpm verify:e2e` | Run e2e against an already-running stack | Yes (host Chromium) | `docker compose up -d` + `pnpm dev` with `WAFFLEBASE_E2E_AUTH=1` |
| `pnpm verify:e2e:standalone` | One-shot wrapper (`scripts/run-e2e-standalone.mjs`) that builds, starts backend + frontend preview in the background, waits on `:3000` and `:5173`, runs the e2e lane, then tears down | Yes | `docker compose up -d` |
| `pnpm verify:ci` (extended) | Adds `verify:e2e:standalone` after existing lanes | Yes | CI services for Postgres + Yorkie |
| `pnpm verify:browser:docker` (unchanged) | Visual + interaction regression in Dockerfile.playwright | Yes (Docker) | — |

Actionable preflight messages (e.g. "start backend with
`WAFFLEBASE_E2E_AUTH=1`" or "docker compose up -d for Postgres + Yorkie")
are emitted from `scripts/run-e2e-standalone.mjs` itself when expected
ports/services are not reachable. `harness.config.json` does not yet
carry a `lanes:` schema; introducing one is left as a follow-up after
the new lane has settled.

CI layout (`.github/workflows/ci.yml`): a new `verify-e2e` job parallel to
`verify-integration`. It declares Postgres and Yorkie as services
(reusing the existing pattern), then builds + starts backend
(`WAFFLEBASE_E2E_AUTH=1`) and frontend in background steps, waits on the
listening ports, runs `pnpm verify:e2e`, and uploads `playwright-report/`
and `test-results/` on failure (14-day retention).

The job is kept separate from `verify-browser` so that:

- Visual regression failures (fast image diffs) surface independently of
  e2e behavioural failures (slower).
- Dockerfile.playwright stays a thin chromium image; it does not gain
  responsibility for booting Postgres/Yorkie/backend.

### Playwright config

`packages/frontend/playwright.config.ts` (sketch):

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e/specs',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['html'], ['github']] : 'list',
  use: {
    baseURL: process.env.WAFFLEBASE_E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } },
  ],
});
```

Mobile project is added when the first mobile-specific spec lands, not
preemptively.

### Proof-of-concept spec

`packages/frontend/tests/e2e/specs/dashboard/create-slides-doc.spec.ts`:

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

Selector policy:

- Prefer `getByRole`, `getByText`, `getByLabel` — accessible by
  construction.
- Fall back to `data-testid` only when role/text selectors are ambiguous or
  missing.
- Avoid CSS class or structural selectors; they break on refactor.
- If a needed selector is missing, add `data-testid` in the same PR.

Cleanup is deferred: PR 1 leaves created docs in the database. A
`freshDoc` fixture with `afterEach` teardown is introduced in PR 2 when
multi-spec leakage starts to matter.

### Agent-facing surface

- `packages/frontend/tests/e2e/README.md` (≤50 lines): how to run, how to
  add, how to debug. Linked from `CLAUDE.md` Commands section.
- `packages/frontend/tests/e2e/__template__.spec.ts`: a minimal Arrange/Act/Assert spec stub with TODO
  markers. Copy-paste is the intended workflow.
- `docs/design/e2e-testing.md` (this document): why the system exists, the
  conventions, the boundaries.
- Future: a user-side skill (under `~/.claude/`, not committed to this
  repo) that detects "just smoke-tested via Puppeteer MCP, want to codify?"
  and walks the agent through generating a spec. Out of scope for the
  first PR.

Updates to existing docs in the first PR:

- `CLAUDE.md` Commands table: add `pnpm verify:e2e`.
- `docs/design/README.md` Common table: link this document.
- `docs/design/harness-engineering.md` lane list: add `verify:e2e`.

### Coexistence rules

| New test kind | Lives in |
|---|---|
| User-visible behavior / interaction | `tests/e2e/` (new) |
| Pixel-diff visual regression | `tests/visual/baselines/` + harness page (existing) |
| jsdom-compatible unit / component | `tests/*.test.ts(x)` (vitest, existing) |

Rule of thumb: if the test is not a pixel comparison, it belongs in the
new system. Adding new scenarios to `packages/frontend/scripts/verify-interaction-browser.mjs` is
disallowed after PR 1; the old verifier is read-only until it is removed.

### Migration roadmap

| PR | Scope |
|---|---|
| **PR 1** (this spec) | Infra + auth fixture + Docker/CI + POC + template + docs |
| PR 2…N | New behavioral specs, 1–3 per PR |
| PR M | Port the three existing interaction scenarios (cell / formula / scroll) |
| PR M+1 | Delete `packages/frontend/scripts/verify-interaction-browser.mjs`; remove the interaction step from `verify:browser:docker` |
| (Deferred) | Visual regression migration to `toHaveScreenshot()` — see Non-Goals |

### Risks and Mitigation

**Test-auth route leaks to production.** Mitigated by env-var gating at
module construction time (route literally not registered without
`WAFFLEBASE_E2E_AUTH=1`), startup log marker, explicit README note. Code
review checklist item for any auth-module change. A post-merge smoke
check on the production backend image confirms `/test/auth/login` returns
404 with the env unset; this becomes part of the PR's verification list.

**Flaky first PR.** Real-route tests against a live stack are more
brittle than harness-page tests. Mitigated by `retries: 2` in CI, trace
artifacts on every failure, and a single high-signal POC scenario (not
ten). If the POC proves flaky within one week post-merge, the lane is
demoted to `continue-on-error: true` while we stabilize; infra stays.

**Workflow drift — new tests still land in legacy verifier.** Mitigated by
explicit "do not add new scenarios" comment at the top of both legacy
scripts and a CLAUDE.md note pointing new tests at `tests/e2e/`. Long-term
mitigation is finishing the migration (PR M+1) so the legacy path
disappears.

**Two systems coexisting indefinitely.** A real risk because we explicitly
defer visual migration. Mitigated by making the coexistence boundary
sharp (pixel-diff = old, everything else = new) and reviewing the deferral
at each release cycle. The visual system is small (≈85 PNGs, one
verifier) and is acceptable to keep if the cost of migration outweighs
the benefit; the decision is revisited, not forgotten.

**Auth fixture stuck on first failure.** A bad cookie cached in
`playwright/.auth/worker-<N>.json` would poison every subsequent run.
Mitigated by deleting the auth cache on Playwright `globalSetup` (fresh
storage state each run, then reused within the run).

**Docker font-consistency regressions.** Not relevant for PR 1 (no
screenshot assertions). Becomes relevant only when the visual migration is
revisited, at which point this design is re-opened.
