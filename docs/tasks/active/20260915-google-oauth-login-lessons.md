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
  into an existing GitHub-created account. GitHub needs no equivalent —
  it only returns verified addresses on the `user:email` scope.

- **An optional strategy has to be optional in two places.** Not providing
  `GoogleStrategy` keeps the app booting without Google credentials, but
  `@UseGuards(AuthGuard('google'))` on the route then fails with passport's
  "Unknown authentication strategy" as a `500`. The guard has to answer
  `404` itself before passport is reached.

## Unverified

- No live Google OAuth client was exercised — the callback was tested
  against a stubbed passport profile, not against Google.
