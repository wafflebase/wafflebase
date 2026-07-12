# Yorkie Auth Webhook — TODO

Design: `docs/design/yorkie-auth-webhook.md`. Branch: `feat/yorkie-auth-webhook`.

Goal: server-enforced per-document read/write access at the Yorkie layer, via a
backend-minted short-lived token + Yorkie auth webhook that reuses the existing
event-webhook HMAC guard.

## Backend

- [x] `AuthService`: add Yorkie token issue/verify
  - `issueYorkieUserToken(userId)` — JWT `{ typ: 'yorkie', sub }`, exp `YORKIE_TOKEN_EXPIRES_IN` (default 10m)
  - `issueYorkieShareToken(shareToken)` — JWT `{ typ: 'yorkie-share', shareToken }`
  - `verifyYorkieToken(token)` → discriminated union, throws on invalid/expired
  - signed with `JWT_SECRET` (reuse accessSecret)
- [x] `AuthController`: token endpoints
  - `GET /auth/yorkie-token` (JwtAuthGuard) → `{ token }` (user)
  - `GET /auth/yorkie-token/share?token=<shareToken>` (public) → `{ token }` (share)
  - throttle both
- [x] `AuthModule`: `exports: [AuthService]`
- [x] `document/yorkie-auth.controller.ts` — `POST /internal/yorkie/auth`
  - `@UseGuards(YorkieSignatureGuard)`, `@SkipThrottle()`
  - decide(): DetachDocument → always allow; verify token (else 401);
    Activate/Deactivate → allow; doc methods → per-attribute access check
  - response: explicit status (200/401/403) + `{ allowed, reason }` body
  - shadow mode: `YORKIE_AUTH_WEBHOOK_ENFORCE` (default false) → log decision, return allow
- [x] `DocumentModule`: import `AuthModule`, register `YorkieAuthController`
- [x] `main.ts`: extend rawBody capture to `/internal/yorkie/` prefix (covers auth + events)

## Frontend

- [x] `api/auth.ts` (or new): `fetchYorkieToken()` / `fetchYorkieShareToken(token)`
- [x] `PrivateRoute.tsx`: `authTokenInjector` → user token
- [x] `shared-document.tsx`: `authTokenInjector` → share token (all YorkieProvider mounts)

## Ops / Docs

- [x] `.env.example` / backend README: `YORKIE_TOKEN_EXPIRES_IN`, `YORKIE_AUTH_WEBHOOK_ENFORCE`
- [x] Local setup note: `yorkie project update` with `--auth-webhook-url` + methods

## Tests

- [x] AuthService yorkie-token round-trip (issue → verify, expiry, wrong typ)
- [x] YorkieAuthController decide(): member rw, share viewer r-only, unknown key, bad token → 401, detach always allow, shadow mode
- [x] `pnpm verify:fast` green

## Verify

- [x] Self code-review over branch diff (workflow, high effort)
- [ ] Manual smoke in `pnpm dev` (shadow mode logs, then enforce)

## Code-review findings (applied)

- [x] **Finding 1 (critical, privilege escalation)** — client-readable Yorkie
  token signed with `JWT_SECRET` was replayable as a Bearer session because
  `JwtStrategy.validate` never checked the token type. Fixed: require
  `tokenType === 'access'` (also closes the pre-existing refresh-token replay
  when `JWT_REFRESH_SECRET` is unset). Updated 4 e2e token helpers.
- [ ] **Finding 2 (viewer verb)** — NOT a code fix: yorkie's verb is
  change-pack-derived, so non-editing viewers get `r`. Documented as a
  shadow-mode rollout validation item (design doc Risks).
- [ ] **Finding 3 (direct URL / non-member)** — by design (canonical URLs need
  membership; share uses the share route). Documented, no change.
- [x] **Finding 4 (fail-open)** — doc method with empty attributes now fails
  closed (403) instead of allow.
- [x] **Finding 5 (cleanup)** — dropped the redundant Document read on the
  share hot path (`findByToken` already loads it).
