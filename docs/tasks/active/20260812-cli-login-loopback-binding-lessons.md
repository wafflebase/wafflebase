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
- Renaming a cookie renames it in every prose that names it, or the design
  doc becomes the bug report. Splitting the CLI binding onto
  `wafflebase_cli_state` updated the code, `backend.md` and `rest-api.md`
  but left `cli.md` (and `CliAuthStore`'s own field comment) still saying
  `wafflebase_oauth_state` — so the canonical CLI design doc described the
  exact collision this change existed to remove. After changing an
  identifier that appears in prose, grep the old spelling repo-wide and
  triage each hit as "this flow" or "the other flow" rather than assuming
  the docs edited alongside the code were all of them.
- A page whose only defence is a human click has to refuse to be framed.
  The CLI consent interstitial was served with no `X-Frame-Options` and no
  `frame-ancestors`, and this backend has no helmet, so nothing supplied
  them: `SameSite=Lax` on the confirm cookie stops a cross-site framer, but
  frontend and backend share eTLD+1 here, so a same-site page could overlay
  the Continue link and harvest the click. When a control is "the user
  deliberately pressed this", clickjacking is in its threat model, and the
  response has to carry the headers itself if nothing global does.
- A control that only exists on some deployments is a control the other
  deployments do not have, and the feature resting on it has to say so. The
  consent gate is one cookie, and `__Host-` — the only thing stopping that
  cookie from being planted — needs `Secure`, so on a plain-http origin the
  gate was open to anything on the origin while the code, the comments and
  the design doc all described it as closed. Fixing the *documentation
  asymmetry* the review flagged would not have closed anything. When a
  defence degrades with configuration, either the feature degrades with it
  (here: `?mode=cli` is a `400` off loopback) or the degradation is the
  feature's real security level. Loopback stayed exempt because there the
  precondition for the attack (writing the origin's cookie jar) already
  means owning the machine.
- Asserting the *subset* of a link's query that a test happened to think of
  lets the rest be deleted silently. The consent-page test pinned `mode`,
  `port` and `cli_confirm`; dropping `nonce` or `code_challenge` from the
  Continue href — which the guard then answers `400`, i.e. no CLI login can
  complete at all — kept the suite green. When a URL re-enters a validating
  route, assert the whole parsed query with `toEqual`, not `toContain` on
  the parts.
- A lookup keyed by a query parameter must not walk a prototype chain. The
  login banner did `ERROR_MESSAGES[error] ?? FALLBACK`, so `?error=toString`
  returned an inherited function — React renders one as nothing, leaving an
  empty box where the reason belongs — and `?error=__proto__` returned an
  object, which React refuses to render at all, taking the login page down.
  A `Map` has no prototype-chain lookup; use one whenever the key comes from
  outside. The review filed this as a cosmetic fallback issue and the first
  test written for the banner covered `login_state` plus one unknown code,
  which passes either way. The crash only surfaced because a later test
  enumerated the inherited members instead of sampling one.
- `??` guards against `undefined`, not against "set but meaningless".
  `bindingSecret` fell back to a random per-process key when `JWT_SECRET` was
  unset but derived from `''` when it was set empty — and `hkdfSync` accepts
  zero-length key material without complaint, so that path produced a fixed
  key anyone can recompute from the source, under which forged `state`
  signatures verify. Strictly worse than the fallback it was skipping. For a
  credential read out of configuration, `||` is the correct operator: empty
  is unset.
- Two agents on one branch is a merge, not a race to be won. A concurrent
  session pushed its own answer to the same `Secure`-flag finding
  (`COOKIE_SECURE` plus a warning) while this one had an automatic
  `req.secure` upgrade committed locally. Both were defensible; shipping
  both would have been two mechanisms for one finding, and the local one
  would silently have overridden the other's explicit `COOKIE_SECURE=false`.
  The published commit wins by default — reset onto it and keep only what it
  does not already cover, rather than force-pushing or layering a second
  answer on top.
