# Support Google account sign-in (issue #78)

**Issue:** [#78](https://github.com/wafflebase/wafflebase/issues/78) — signup /
login with a Google account. Today `/auth/github` is the only way in.

## Problem

`AuthModule` registers exactly one OAuth strategy (`GitHubStrategy`), the
login page offers exactly one button, and `Document`/`User.authProvider` has
only ever held `"github"`. Anyone without a GitHub account cannot sign in.

## Decisions (the open questions on the issue)

1. **Same email, two providers → one user.** `findOrCreateUser()` already
   looks up by email alone, so a Google sign-in with an email that already
   has an account signs into *that* account. Kept deliberately rather than
   split into two rows: the alternative silently gives one person two
   workspaces. The safety condition is that the email be **verified** — a
   Google profile whose `email_verified` is false is refused at
   `GoogleStrategy.validate()`, because otherwise an unverified address
   would be a way into an existing GitHub-created account.
2. **Web only.** `?mode=cli` stays a GitHub flow. The CLI's loopback +
   consent-page machinery is GitHub-shaped (`CliLoginConfirmMiddleware` is
   mounted on `GET /auth/github`), and nothing about the issue asks for a
   second CLI path.
3. **Google is optional.** `passport-google-oauth20` throws when `clientID`
   is missing, so registering the strategy unconditionally would stop every
   existing deployment from booting. The strategy is only provided when
   `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_CALLBACK_URL` are
   all set; the routes answer `404` otherwise, and the login page asks
   `GET /auth/providers` so the button only appears where it works.

## Approach (one PR)

- [x] `passport-google-oauth20` + `@types/passport-google-oauth20` as
      backend dependencies.
- [x] `oauth-providers.ts` — `googleAuthConfigured()` /
      `googleAuthPartiallyConfigured()`, read off `process.env` like the
      rest of the auth module's environment checks.
- [x] `web-oauth-login.ts` — the double-submit `state` mint + `returnTo`
      cookie, and the callback's consume half, lifted out of
      `GitHubAuthGuard` / `AuthController` so both providers run the *same*
      CSRF check rather than a copy of it.
- [x] `google.strategy.ts` — mirrors `GitHubStrategy` (forwards
      `__oauthState`, `scope: ['profile', 'email']`), refuses an unverified
      email.
- [x] `google-auth.guard.ts` — `GoogleAuthGuard` (start: assert configured,
      mint state) and `GoogleCallbackGuard` (assert configured), so an
      unconfigured deployment gets a `404` instead of passport's "Unknown
      authentication strategy" `500`.
- [x] `auth.controller.ts` — `GET /auth/google`, `GET /auth/google/callback`,
      `GET /auth/providers`; GitHub's callback body refactored onto the same
      `verifyWebState` / `finishWebLogin` helpers.
- [x] Frontend — `fetchAuthProviders()`, a second `WbButton` (ghost) on the
      login form, rendered only when the backend says Google is enabled.
- [x] Docs — `packages/backend/README.md` env table, `docs/design/backend.md`
      auth section + the "single OAuth provider" risk entry.

## Test plan

- `packages/backend/src/auth/google.strategy.spec.ts` — provider fields,
  unverified-email refusal, `state` forwarding.
- `packages/backend/src/auth/google-auth.guard.spec.ts` — `404` when
  unconfigured, state cookie minted when configured.
- `packages/backend/src/auth/auth.controller.spec.ts` — `/auth/providers`,
  the Google callback's state check and its session cookies.
- `packages/frontend/src/components/__tests__/login-form.test.tsx` — the
  Google button appears only when the providers call says so.

## Out of scope

Account linking UI, unlinking, email/password, Google CLI login, showing
which provider an existing account was created with.
