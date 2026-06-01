# TODO — E2E Testing with @playwright/test

Design doc: [docs/design/e2e-testing.md](../../design/e2e-testing.md)

One PR introducing infrastructure, auth fixture, Docker/CI integration,
one POC scenario, and agent-facing docs/template. Visual baseline
migration is explicitly deferred — see design doc Non-Goals.

## PR 1 — Infra + POC

User value: behavioral e2e tests live in a single, agent-friendly home,
with one demonstrable scenario proving the loop end-to-end.

- [ ] commit 1 — `feat(backend): test-only POST /test/auth/login route`
  - Gated on `WAFFLEBASE_E2E_AUTH=1`; module-construction guard
  - Reuses `AuthService.signTokens()` and `findOrCreateUser`
  - Startup log marker when enabled
  - Unit test: route exists when env set, 404 when unset
- [ ] commit 2 — `chore(frontend): add @playwright/test, playwright.config, fixtures scaffold`
  - Add devDependency, pin to existing Playwright version (1.58.2)
  - `playwright.config.ts` with `baseURL`, trace/screenshot/video on failure
  - `tests/e2e/fixtures/{auth.ts,index.ts}` with worker-scoped storageState
  - `tests/e2e/__template__.spec.ts` Arrange/Act/Assert stub
  - `tests/e2e/README.md` (≤50 lines)
- [ ] commit 3 — `feat(frontend): POC e2e — create slides document from dashboard`
  - `specs/dashboard/create-slides-doc.spec.ts`
  - Add any missing `data-testid` to dashboard / slides editor
  - Selector policy: getByRole first, testid only when necessary
- [ ] commit 4 — `feat(harness): verify:e2e + verify:e2e:standalone lanes`
  - Root `package.json` scripts
  - `scripts/run-e2e-standalone.mjs` orchestrator (boot backend +
    frontend preview, wait-on, run, teardown, actionable preflight
    errors for missing Postgres/Yorkie/env)
  - Append `pnpm verify:e2e` to `CLAUDE.md` Commands table
- [ ] commit 5 — `ci: verify-e2e GitHub Actions job`
  - Postgres + Yorkie services
  - Backend started with `WAFFLEBASE_E2E_AUTH=1`
  - Upload `playwright-report/` + `test-results/` on failure
- [ ] commit 6 — `docs: e2e-testing design doc + cross-links`
  - `docs/design/e2e-testing.md` (this spec)
  - `docs/design/README.md` Common table row
  - `docs/design/harness-engineering.md` lane list update
  - "Do not add new scenarios" header on legacy `verify-*-browser.mjs`
- [ ] verify: `pnpm verify:fast` per commit
- [ ] verify: full local run — `pnpm verify:e2e` against running stack
- [ ] verify: standalone — `pnpm verify:e2e:standalone` succeeds from
  clean state with only `docker compose up -d`
- [ ] verify: CI green on a feature branch (Postgres + Yorkie services
  reachable, trace artifact uploads on a forced failure)
- [ ] verify: induced failure produces usable trace.zip (`npx playwright
  show-trace`)
- [ ] verify: production build of backend confirms `/test/auth/login`
  returns 404 when env unset
- [ ] self-review via `/code-review` or `superpowers:requesting-code-review`
- [ ] PR opened, reviewed, merged

## Out of scope for PR 1 (tracked here for future picks)

- Port `cell-input` / `formula` / `scroll` from
  `verify-interaction-browser.mjs` to Playwright Test
- `freshDoc` fixture with `afterEach` document deletion
- Mobile project in `playwright.config.ts` (added when first mobile spec
  lands)
- User-side skill that detects "smoke-tested via MCP, codify?" flow
- Visual baseline migration — explicitly deferred, decision revisited at
  each release cycle

## Lessons

See [20260601-e2e-playwright-test-lessons.md](20260601-e2e-playwright-test-lessons.md).
