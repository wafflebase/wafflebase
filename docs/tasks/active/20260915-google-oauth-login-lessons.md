# Google account sign-in — Lessons

Paired with `20260915-google-oauth-login-todo.md` (issue #78).

## Findings

- **The second provider is where the OAuth `state` check gets copied.** The
  browser half of the login (mint a secret into `__Host-wafflebase_oauth_state`,
  send its SHA-256 as `state`, compare on the way back) lived inline in
  `GitHubAuthGuard.canActivate()` and `AuthController.githubAuthCallback()`.
  Copying it for Google would have meant two implementations of the one
  check that stops login CSRF, and a future fix landing in only one. It was
  extracted to `web-oauth-login.ts` first, then used twice.

- **`findOrCreateUser()` decides the account-merge question, not the
  strategy.** It looks up by email only, so adding a provider silently
  chose "same email = same user" before any code was written for it. That
  makes the *email verification* check the load-bearing part of the Google
  strategy: without it, an unverified Google address would sign somebody
  into an existing GitHub-created account. GitHub turned out to need the
  same check (`GET /user/emails` returns unverified addresses, and the
  primary can be one) — but checking it going forward says nothing about
  the rows already in the table, which is why the merge is gated on
  `User.emailVerifiedAt` rather than on the check alone.

- **A refusal raised inside a passport strategy is raised in the wrong
  place.** `validate()` runs inside `AuthGuard(...)`, before the callback
  handler, so throwing there bypasses the `/login?error=` contract the
  callback owns and — for a CLI login — leaves `wafflebase login` blocked
  on a loopback callback until its five-minute timeout. The strategies
  return the refusal; the callback, which is the only code that knows
  which flow this is, routes it.

- **Widening a config read widens everything that reads it.**
  `isSecureCookie()` also answers `cliLoginAvailable()` and
  `insecureProductionOrigin()`, so letting `GOOGLE_CALLBACK_URL` answer
  negatively would have let an `http://` Google callback strip `Secure`
  off an install that reads as https today. It is read upgrade-only.

- **An optional strategy has to be optional in two places.** Not providing
  `GoogleStrategy` keeps the app booting without Google credentials, but
  `@UseGuards(AuthGuard('google'))` on the route then fails with passport's
  "Unknown authentication strategy" as a `500`. The guard has to answer
  `404` itself before passport is reached.

## Unverified

- No live Google OAuth client was exercised — the callback was tested
  against a stubbed passport profile, not against Google.
