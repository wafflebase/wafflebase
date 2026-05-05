---
title: Fix CLI 404 when access token is expired
date: 2026-05-05
status: completed
---

# Fix CLI 404 when access token is expired

## Problem

`wafflebase docs list` (and any other CLI subcommand) returns

```
{ "error": { "code": "ERROR", "message": "HTTP 404" } }
```

once the session's access token has expired, even though a valid refresh
token is sitting in `~/.wafflebase/session.json`.

## Root cause

`packages/cli/src/config/config.ts:104` only adopts the saved session when
`!isSessionExpired(session)`. If the access token is past its `expiresAt`,
the JWT branch is skipped, the function falls through to `authMode: 'none'`,
and `session.activeWorkspace` is dropped. The HTTP client then constructs

```
GET https://api.wafflebase.io/api/v1/workspaces//documents
```

with an empty workspace segment, which the backend rejects with a 404.

`HttpClient.refreshSession` already knows how to swap the access token for
a fresh one on a 401, but it only fires when `authMode === 'jwt'` and a
refresh token is present — exactly the state `resolveConfig` refuses to
hand it.

## Plan

- [x] Add a failing test in `packages/cli/test/config.test.ts` covering the
      "expired access token but valid refresh token" case: `resolveConfig`
      must return `authMode: 'jwt'`, the session's `accessToken` /
      `refreshToken`, and `session.activeWorkspace`.
- [x] In `resolveConfig`, drop the `!isSessionExpired(session)` gate so a
      session with both tokens always selects JWT auth. Let the HTTP client
      handle the actual expiration via its existing 401 → refresh → retry
      path.
- [x] Manually verify with the real CLI: forced
      `~/.wafflebase/session.json` `expiresAt` into the past, confirmed
      installed CLI returned `HTTP 404`, then ran the patched CLI from
      source (`pnpm --filter @wafflebase/cli dev docs list`) and it
      auto-refreshed the access token and returned the document list.
- [x] Run `pnpm -w run verify:fast` — exit 0.

## Notes

- The `wafflebase status` command still uses `isSessionExpired` to decide
  whether to print "valid" / "expired"; that's a UX hint and is fine — we
  only want to stop *config resolution* from giving up early.
- `SESSION_EXPIRED` error path in `HttpClient.request` already covers the
  "refresh token also dead" scenario, so users still get a clear
  "run `wafflebase login`" message when both tokens are gone.

## Review

Single-file behavior change in `packages/cli/src/config/config.ts`: stop
gating session adoption on `!isSessionExpired`. The HTTP client's existing
401 → refresh path now actually runs in the scenario it was designed for
(expired access token, live refresh token), and the active workspace from
the session is no longer dropped — which was the proximate cause of the
malformed `/api/v1/workspaces//documents` URL and the resulting 404.

Test coverage added: a regression case in `packages/cli/test/config.test.ts`
asserts that an expired-access-token session still resolves to
`authMode: 'jwt'` with the session workspace and both tokens intact.
