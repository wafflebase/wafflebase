# Backend Hardening — CTO Review Quick Wins

Drawn from the CTO codebase review on 2026-05-24. Picks the four
highest-ROI, lowest-cost items from the Critical / High buckets so the
backend can sit safely behind a public URL: CSRF defense, rate
limiting, request validation, and basic observability.

## Context

Findings verified directly (grep / Read against current `main`):

- `packages/backend/src/auth/auth.controller.ts:229` — session and
  refresh cookies set with `sameSite: 'none'` in production. With no
  CSRF token, any cross-origin site can ride the user's session.
- `packages/backend/src/` — zero hits for `Throttle`, `throttler`, or
  any rate-limit middleware. `/auth/refresh`, `/auth/github/callback`,
  API key auth, and v1 endpoints are unprotected against brute-force
  or scraping.
- `packages/backend/src/` — zero hits for `class-validator`,
  `IsString`, or `ValidationPipe`. Controllers accept raw payloads
  (e.g. `@Body() body: { title: string }`); role-bearing fields on
  invite endpoints are not validated.
- No structured logger (pino / winston), no `/health` endpoint. Prod
  incidents would be invisible.

## Scope

Four independent commits, no inter-dependencies. Ordered by risk.

### Commit 1 — CSRF / SameSite fix

- [ ] `packages/backend/src/auth/auth.controller.ts` — switch access
  and refresh cookies from `sameSite: 'none'` to `'lax'` in
  production. Reserve `'none'` for cases that actually need
  third-party embed, paired with a CSRF token.
- [ ] Audit every `res.cookie` / `res.clearCookie` call in the
  controller so set/clear options match (mismatched options leave
  stale cookies in the browser).
- [ ] Regression test: extend `auth.controller.spec` (or add one) to
  assert the cookie options object.
- [ ] Document deployment assumption: frontend and backend must share
  an eTLD+1 (e.g. `*.wafflebase.com`) for `'lax'` to send cookies on
  the OAuth callback. Cross-eTLD deployment needs a follow-up task.

### Commit 2 — Rate limiting (`@nestjs/throttler`)

- [ ] `pnpm --filter @wafflebase/backend add @nestjs/throttler`.
- [ ] Register `ThrottlerModule` and a global `APP_GUARD` in
  `app.module.ts`.
- [ ] Policies:
  - Global default: 60 req / 60s / IP.
  - `/auth/github/callback`, `/auth/refresh`: 10 req / 60s / IP.
  - `/api/v1/*`: 600 req / 60s / authenticated principal (per-API-key
    bucketing is a follow-up).
- [ ] Regression test: one endpoint returns 429 after burst.
- [ ] Loosen limits under `NODE_ENV=test` so the existing
  `verify:integration` lane is not broken.

### Commit 3 — Input validation (ValidationPipe + DTOs)

- [ ] `pnpm --filter @wafflebase/backend add class-validator class-transformer`.
- [ ] Wire a global `ValidationPipe({ whitelist: true,
  forbidNonWhitelisted: true, transform: true })` in `main.ts`.
- [ ] Promote inline body types to DTO classes (highest-risk endpoints
  first):
  - `document.controller.ts` — `CreateDocumentDto`,
    `UpdateDocumentDto`.
  - `workspace.controller.ts` — `CreateWorkspaceDto`,
    `InviteMemberDto`, `UpdateMemberRoleDto` (role enum validation is
    mandatory — prevents privilege escalation via malformed body).
  - `api/v1/documents.controller.ts`, `tabs.controller.ts`,
    `cells.controller.ts` — every POST/PATCH/PUT body.
  - `api-key.controller.ts` — `CreateApiKeyDto`.
- [ ] Regression tests: each touched controller gets one negative
  case (missing field, wrong type, unknown property) returning 400.
- [ ] Existing `*.e2e-spec.ts` suites stay green.

### Commit 4 — Observability (Pino + `/health`)

- [ ] `pnpm --filter @wafflebase/backend add nestjs-pino pino-http`;
  `pino-pretty` as a dev dependency.
- [ ] Replace the default Nest logger with Pino in `main.ts`. Level
  controlled by `LOG_LEVEL` env (default `info`).
- [ ] New `health.controller.ts`:
  - `GET /health` — liveness, always 200, no auth.
  - `GET /health/ready` — readiness: Prisma `SELECT 1` + Yorkie
    reachability. 503 on dependency failure. No auth.
- [ ] Regression tests: `/health` 200; `/health/ready` returns 503
  when Prisma client is mocked to throw.
- [ ] Short observability section in `docs/design/backend.md`: log
  format, health contract, env knobs.

## Verification (per commit)

- `pnpm verify:fast` green.
- Backend e2e where touched: `pnpm --filter @wafflebase/backend
  test:e2e` with `RUN_DB_INTEGRATION_TESTS=true` when DB is up.
- After the last commit: `pnpm verify:self` green.

## Out of scope

- Sentry / Datadog integration — separate PR (needs DSN / project
  decisions).
- Lifting backend unit coverage from 0.21:1 toward 0.5:1 — separate
  series.
- Jest → Vitest migration — its own task (1–2 days standalone).
- CSRF token (double-submit) — only needed if third-party embed gets
  reintroduced; `'lax'` covers the common case.
- Yorkie adapter package extraction, theme unification, slides /
  frontend size reduction — medium-term structural debt.

## Rollback plan

- Commit 1: one-line revert of the `sameSite` value. If we discover a
  cross-eTLD prod topology, open a follow-up to add a CSRF token and
  restore `'none'`.
- Commit 2: removing the `APP_GUARD` registration disables throttling
  instantly. Tune policy if a real workload trips a false positive.
- Commit 3: DTOs apply per-controller, so partial revert is cheap.
  Removing the global `ValidationPipe` restores prior behavior.
- Commit 4: Pino swap is a single `main.ts` line; `/health` is a new
  route with no callers to break.

## Review

(After landing: PR links, follow-ups discovered, link to the paired
lessons file.)
