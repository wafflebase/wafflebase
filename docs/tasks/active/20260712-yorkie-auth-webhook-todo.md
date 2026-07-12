# Yorkie Auth Webhook — TODO

Design: `docs/design/yorkie-auth-webhook.md`. Branch: `feat/yorkie-auth-webhook`.

Goal: server-enforced per-document read/write access at the Yorkie layer, via a
backend-minted short-lived token + Yorkie auth webhook that reuses the existing
event-webhook HMAC guard.

## Backend

- [ ] `AuthService`: add Yorkie token issue/verify
  - `issueYorkieUserToken(userId)` — JWT `{ typ: 'yorkie', sub }`, exp `YORKIE_TOKEN_EXPIRES_IN` (default 10m)
  - `issueYorkieShareToken(shareToken)` — JWT `{ typ: 'yorkie-share', shareToken }`
  - `verifyYorkieToken(token)` → discriminated union, throws on invalid/expired
  - signed with `JWT_SECRET` (reuse accessSecret)
- [ ] `AuthController`: token endpoints
  - `GET /auth/yorkie-token` (JwtAuthGuard) → `{ token }` (user)
  - `GET /auth/yorkie-token/share?token=<shareToken>` (public) → `{ token }` (share)
  - throttle both
- [ ] `AuthModule`: `exports: [AuthService]`
- [ ] `document/yorkie-auth.controller.ts` — `POST /internal/yorkie/auth`
  - `@UseGuards(YorkieSignatureGuard)`, `@SkipThrottle()`
  - decide(): DetachDocument → always allow; verify token (else 401);
    Activate/Deactivate → allow; doc methods → per-attribute access check
  - response: explicit status (200/401/403) + `{ allowed, reason }` body
  - shadow mode: `YORKIE_AUTH_WEBHOOK_ENFORCE` (default false) → log decision, return allow
- [ ] `DocumentModule`: import `AuthModule`, register `YorkieAuthController`
- [ ] `main.ts`: extend rawBody capture to `/internal/yorkie/` prefix (covers auth + events)

## Frontend

- [ ] `api/auth.ts` (or new): `fetchYorkieToken()` / `fetchYorkieShareToken(token)`
- [ ] `PrivateRoute.tsx`: `authTokenInjector` → user token
- [ ] `shared-document.tsx`: `authTokenInjector` → share token (all YorkieProvider mounts)

## Ops / Docs

- [ ] `.env.example` / backend README: `YORKIE_TOKEN_EXPIRES_IN`, `YORKIE_AUTH_WEBHOOK_ENFORCE`
- [ ] Local setup note: `yorkie project update` with `--auth-webhook-url` + methods

## Tests

- [ ] AuthService yorkie-token round-trip (issue → verify, expiry, wrong typ)
- [ ] YorkieAuthController decide(): member rw, share viewer r-only, unknown key, bad token → 401, detach always allow, shadow mode
- [ ] `pnpm verify:fast` green

## Verify

- [ ] Self code-review over branch diff
- [ ] Manual smoke in `pnpm dev` (shadow mode logs, then enforce)
