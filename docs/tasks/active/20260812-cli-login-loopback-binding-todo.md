# CLI login: bind the loopback callback (nonce echo + PKCE)

Related: #654/#655 (CLI session commands), RFC 8252 §8.9, RFC 7636

## Problem

`wafflebase login` starts an HTTP listener on `127.0.0.1:<ephemeral-port>`
and redeems the first `?code=` that reaches `/callback`. Loopback is not a
boundary here: the port range is small and guessable, and any page in the
user's browser can navigate to it (a top-level navigation, an `<img>`, a
no-cors `fetch`). Nothing tied the arriving code to the flow this process
started, so an attacker who minted a code against their own account and
pushed it at the port logged the victim's terminal into the attacker's
account — after which every `wafflebase` write lands in the attacker's
workspace. That is textbook authorization-code injection.

A first attempt at this shipped inside the #661 error-envelope branch and
was reverted for landing half-done: no test over the guard's ingestion, no
assertion that the CLI even sent the parameter, no PKCE, and a hard
requirement on a `state` echo only the new backend sends (an older server
turned every login into a silent 30-second timeout). This is that work
redone in full — plan, tests, and docs of its own.

**Where it landed.** It rides the #661 branch again (PR #786), not a
separate one. What was wrong the first time was *half-done work* riding
along, not the sharing of a branch: the two touch `login.ts` from opposite
ends (the OAuth handshake vs. the failure envelope), so splitting them now
would mean two PRs whose only conflict is that file. Recorded here rather
than left as an unexplained divergence from the paragraph above; the next
piece of login work starts from `main` on its own branch.

## Plan

- [x] CLI mints a 32-byte nonce, sends it as `nonce=` on the OAuth start
      URL, and refuses any callback whose `state` does not match it
      (constant-time compare). The listener stays open on a refusal, so a
      probe cannot abort a genuine login still in flight.
- [x] CLI mints a PKCE verifier, sends only `code_challenge` (S256), and
      supplies `codeVerifier` at `POST /auth/cli/exchange`.
- [x] `GitHubAuthGuard` reads both off the query string and stores them
      with the state, length-bounded (nonce ≤128; challenge 43–128 and
      base64url only) because both are attacker-influenceable and one is
      echoed into a redirect URL.
- [x] `AuthController` echoes the nonce back as `state` on the loopback
      redirect and carries the challenge onto the authorization code.
- [x] `CliAuthStore.consumeCode` requires the matching verifier for a
      challenged code, burns the code either way, and reports a mismatch
      as an ordinary miss (no oracle). A verifier presented against an
      *unchallenged* code is refused as well (RFC 7636 §4.6) — otherwise
      an attacker starts an unchallenged login at the victim's port and
      nonce and the victim's CLI spends the attacker's code.
- [x] A `code_challenge` that is sent but fails the guard's bounds is a
      `400`, not a silently dropped parameter: continuing would downgrade
      a login the client believes is PKCE-bound, undetectably at both ends.
- [x] Both parameters are **required** server-side (review round 2). They
      were optional so an older CLI kept working, but on the wire "does
      not support it" and "chose not to send it" are the same request, so
      an optional binding is no binding: the injection stayed open for any
      client that omitted it. A `mode=cli` start URL missing either one is
      now a `400` naming the parameter. Back-compat runs neither way now —
      an older CLI upgrades, or uses `--api-key`, which needs no browser.
- [x] The CLI state is bound to the browser that started it (review round
      2, critical). The nonce and the verifier are both held by whoever
      *starts* a login, so neither sees an attacker who mints a CLI state
      pointing at a loopback port they own and walks the victim through
      consent — on a shared host that is the victim's code in the
      attacker's CLI. `GET /auth/github?mode=cli` now sets a short-lived
      `wafflebase_cli_state` cookie (its own name — sharing the browser
      flow's slot let a second start overwrite the first's binding) and
      remembers it as `StateEntry.browserBinding`; the callback compares it
      constant-time before the user is looked up, and clears it either way.
- [x] Tests: `github-auth.guard.spec.ts` over ingestion and its bounds;
      `auth.controller.spec.ts` over the `state` echo and the four PKCE
      outcomes; `login-callback.test.ts` over the callback gate (including
      a *same-length* wrong nonce, which a length-only compare would let
      through) and over the real `login` action's wire format.
- [x] Docs: `cli.md` §3.1 login flow, `rest-api.md` §7 + risk table.
- [x] The authorization URL carries two of the bindings, so it never goes
      to stderr, which is what an agent harness captures into logs. It is
      announced either way, though — `open()` resolving only means the
      child was spawned, not that a browser appeared, so gating on it left
      headless users with no way to continue (review round 2): stderr when
      stderr is a terminal, otherwise a `0600` `login-url.txt` beside the
      config file, deleted as soon as the login settles. A spawn `ENOENT`
      arrives asynchronously and is absorbed rather than crashing the CLI.
      The backend redacts `/auth` query strings out of its access log for
      the same reason (a 4xx there logs at `warn`), matching every spelling
      Express routes — case-insensitive, percent-decoded — not just the
      lowercase literal.
- [x] `login` codes a backend failure from its status — 401/403
      `UNAUTHORIZED`, 5xx `SYSTEM`, otherwise `HTTP_ERROR` — instead of
      calling every one an auth failure, and each call site `return`s the
      failure rather than trusting `process.exit` to unwind.

## Out of scope

- ~~Converting the `csrf` value `CliAuthStore` mints alongside the state
  token into an enforced control, or deleting it.~~ Done in review round
  2: the unread `csrf` field is gone, replaced by `browserBinding`, which
  the callback enforces.
- Rotating the loopback listener onto a fixed registered port or a
  `Sec-Fetch-Site` check. The two bindings above are the RFC's own
  prescription; origin headers are advisory on a plain-`GET` navigation.
- (No longer out of scope.) CSRF state on the **browser** login was
  deferred here as its own change, and review would not carry the
  deferral: leaving `GitHubAuthGuard` minting a state only for
  `mode=cli` means a plain browser login sends none, and the callback
  validates nothing (forced-login CSRF). It is closed in this change
  instead — a `w.`-prefixed random `state` with its other half in a
  short-lived `wafflebase_oauth_state` cookie, compared constant-time on
  the callback before the user is touched, and a callback with no
  `state` at all is refused.

## Acceptance criteria

- [x] A callback carrying a valid-looking `code` but no/wrong `state` is
      answered `400` and never redeemed.
- [x] A code minted under PKCE cannot be exchanged without the verifier,
      and a code minted *without* one cannot be exchanged *with* a
      verifier either.
- [x] A CLI that sends neither parameter is refused with a `400` naming
      the missing one (replaces the earlier criterion, which asked for
      behavior that left the binding optional and therefore absent).
- [x] A CLI callback whose `state` is valid but whose browser presents no
      matching cookie is refused before any user record is touched.
- [x] `logSafeUrl` redacts `/AUTH/...` and `/%61uth/...`, not just
      `/auth/...`, and has tests of its own.
- [x] A browser login whose callback carries no `state`, or one that does
      not match its cookie, is refused before any user record is touched.
- [x] `wafflebase login` against a backend that ignores both parameters
      fails closed with a message naming the cause (it does **not**
      complete — see the plan bullet above; this replaces the earlier
      criterion, which asked for behavior that would reopen the hole).

## Review round 2 (2026-08-15)

The panel accepted the bindings but not their reach. Added in this round:

- [x] A CLI start does not redirect to GitHub on its own — the backend
      renders a consent page naming the loopback port, and continuing
      echoes a token that page set as a `wafflebase_cli_confirm` cookie.
      The nonce, the challenge and the browser-binding cookie are all
      held by whoever *wrote* the start URL, so none of them saw a victim
      clicking `?mode=cli&port=<attacker's listener>`.
- [x] The browser flow's `state` is the HMAC of the state cookie rather
      than a copy of it, and the cookie carries `__Host-` in production
      (`Path=/`). An unsigned double submit is only as strong as the
      cookie jar, and a sibling subdomain can write that.
- [x] The authorization URL never reaches `open()`. The browser is given
      a single-use `http://127.0.0.1:<port>/launch/<token>` redirect, so
      the nonce and PKCE challenge stay out of a child process's argv,
      which any local user can read on the shared host the bindings are
      for.
- [x] `logSafeUrl` redacts granting query parameters everywhere, not just
      under `/auth` — `GET /documents/:id/file?token=` carries a
      share-link credential and is logged at `warn` on every 4xx.
- [x] A browser callback that fails the state check lands on
      `FRONTEND_URL/login?error=login_state`, which the login form
      explains, instead of a JSON `401` with no way back.
- [x] `openBrowser`'s async `error` absorption has a test that fails if
      the listener is dropped (an `EventEmitter` with no `error` listener
      rethrows).
