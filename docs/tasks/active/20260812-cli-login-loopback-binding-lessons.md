# Lessons — CLI login: bind the loopback callback (nonce echo + PKCE)

Related: #654/#655, RFC 8252 §8.9, RFC 7636

## Notes

- The nonce echo and PKCE look redundant and are not. The nonce protects
  the *client* (the CLI refuses a code that is not from its own flow); PKCE
  protects the *code* (nobody but the CLI can redeem it, wherever it
  leaked). Either alone leaves the other hole open, and both are cheap:
  two `randomBytes` calls and one hash.
- Half of a two-sided protocol change is worse than none. The first attempt
  made the CLI *require* an echo only the new backend sends, which turned a
  login against any older or self-hosted server into a 30-second silence
  ending in "Login timed out." The requirement is still there — it has to
  be, since accepting the unbound code *is* the vulnerability — but it is
  now stated as such: the one case that cannot be accepted says *why* on
  timeout instead of blaming the clock, and the docs say plainly that
  compatibility runs one way (old CLI → new server, not the reverse).
  Review caught the version of this doc that claimed *both* directions
  worked two sentences before describing the refusal that makes one of them
  impossible. A compatibility claim is a testable assertion; if no test
  drives it, write down the direction that actually holds.
- "Optional" is not the same as "ignorable". `code_challenge` was optional
  *and* silently dropped when malformed, which is a PKCE downgrade a client
  cannot observe: it thinks it is bound, the server issues a bearer code.
  An optional parameter that arrives must either be honored or fail the
  request.
- PKCE has to be checked in both directions. Requiring the verifier when a
  challenge was stored is the obvious half; refusing a verifier when *no*
  challenge was stored (RFC 7636 §4.6) is the half that stops an attacker
  from starting an unchallenged flow at the victim's port and nonce and
  having the victim's own CLI redeem it. Without it the second binding
  collapses to the first.
- A risk table row states the scope of the control, not just the control.
  "State token minted per OAuth request" read as if the browser login were
  covered; the guard only mints one for `mode=cli`. An added-but-partial
  gate documented without its boundary is worse than no row at all.
- A rejected callback must not settle the promise. Answering `400` and
  leaving the listener open is what keeps an attacker's probe from being a
  denial of service against a genuine login that has not arrived yet.
- Testing the callback gate is not enough: nothing there proves the CLI
  ever *sends* `nonce=`. `test/login-callback.test.ts` therefore drives the
  real `registerLoginCommand` action — `open` mocked, `fetch` stubbed
  except for 127.0.0.1, `WAFFLEBASE_SESSION` pointed at a temp file — and
  reads the OAuth URL back off the notice the command prints. That is the
  only assertion that would catch the parameter being renamed.
- A mismatch test has to defeat the short-circuit. `nonceMatches` is
  `length === length && timingSafeEqual`, so "no state" and a shorter wrong
  state both stop at the length check and never exercise the comparison. A
  same-length wrong nonce is the case that fails if the body degrades to a
  length compare.
- Stubbing passport in a guard spec: `jest.spyOn(Object.getPrototypeOf(
  GitHubAuthGuard.prototype), 'canActivate')`. The mixin `AuthGuard('github')`
  returns *is* the prototype chain link, so this replaces the redirect
  machinery without a module mock.

## Round 3 — panel review of PR #786 (blast-radius / security / correctness)

- Adding a human gate to a flow changes the *other* end's budget. The
  consent interstitial put a person's reading-and-clicking time inside a
  window the CLI still bounded at 30 seconds, while the server held the
  login for five minutes. Neither end was wrong on its own; together they
  disagreed by an order of magnitude, and the CLI's own headless notice had
  been promising the server's number all along. When a step is inserted into
  a flow, re-derive every timeout that has to span it — and prefer naming
  the constant after the budget it must match (`CALLBACK_TIMEOUT_MS` ==
  `STATE_COOKIE_MAX_AGE_MS`) so the next change surfaces the coupling.
- Two flows sharing one cookie *name* is two flows sharing one slot. The
  browser and CLI logins each set `wafflebase_oauth_state`, so starting one
  while the other was mid-flight silently overwrote its binding and the
  first callback was then refused as a forgery — a login failing for a
  reason no log line and no user could see. A binding that is per-login
  needs a namespace that is per-flow.
- "Missing and malformed are the same failure" has to cover *every*
  parameter, or the exception is the hole. `nonce` and `code_challenge`
  each got that rule; `port` kept an `if (valid) { … }` whose else-branch
  fell through to the browser login, so an unusable port issued the person
  real session cookies for a sign-in they had asked to hand to a terminal.
  A validation rule stated in a comment should be checked against each
  input the comment claims to cover.
- A signature over a value the server hands out is not a secret. The
  browser `state` is `HMAC(secret, cookieValue)`, documented as making
  cookie planting insufficient — but `GET /auth/github` is unauthenticated
  and returns *both* halves (the cookie in `Set-Cookie`, its signature in
  the redirect's `state`), so an attacker just harvests a valid pair. The
  signature's real value is narrower: a `state` the server never issued
  cannot be invented. `__Host-` is the whole of the cookie-planting
  defence. Before writing "X means an attacker cannot Y", ask what one
  unauthenticated request to the endpoint returns.
- A security control keyed on `NODE_ENV` is keyed on a variable nobody
  audits. `__Host-` was applied only under `NODE_ENV=production`, so every
  https deployment that did not set it lost the one control holding the
  double submit together. Derive it from something the deployment *must*
  get right for the feature to work at all — here `GITHUB_CALLBACK_URL`'s
  scheme, which GitHub itself has to agree with, and which is identical on
  the request that sets the cookie and the callback that reads it (a
  per-request `req.secure` behind a proxy would not be).
- Redaction lists that only know query parameters miss credentials in the
  path. `?token=` was scrubbed while `GET /share-links/:token/resolve`
  logged the same share token verbatim — and that route 4xxes on a revoked
  or expired link, which is logged at `warn`. When adding a parameter to a
  redaction list, grep for the credential's *other* carriers before calling
  it covered.
