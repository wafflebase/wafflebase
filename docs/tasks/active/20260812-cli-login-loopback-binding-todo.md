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
- [x] Back-compat runs **one way**, and the docs say so. Both parameters
      are optional server-side, so an older CLI still logs in against a
      current backend. A current CLI cannot complete its browser login
      against a backend that does not echo the nonce — it refuses the
      unbound code and names that cause on timeout — because accepting it
      is exactly the injection this task closes. `--api-key` covers an
      older deployment until it is upgraded.
- [x] Tests: `github-auth.guard.spec.ts` over ingestion and its bounds;
      `auth.controller.spec.ts` over the `state` echo and the four PKCE
      outcomes; `login-callback.test.ts` over the callback gate (including
      a *same-length* wrong nonce, which a length-only compare would let
      through) and over the real `login` action's wire format.
- [x] Docs: `cli.md` §3.1 login flow, `rest-api.md` §7 + risk table.
- [x] The authorization URL carries both bindings, so it is handed to the
      browser and printed only when the browser cannot be opened; the
      backend redacts `/auth` query strings out of its access log for the
      same reason (a 4xx there logs at `warn`).
- [x] `login` codes a backend failure from its status — 401/403
      `UNAUTHORIZED`, 5xx `SYSTEM`, otherwise `HTTP_ERROR` — instead of
      calling every one an auth failure, and each call site `return`s the
      failure rather than trusting `process.exit` to unwind.

## Out of scope

- Converting the `csrf` value `CliAuthStore` mints alongside the state
  token into an enforced control, or deleting it. The state token is
  itself the opaque single-use guard; `csrf` has no reader. Noted in the
  `rest-api.md` risk row rather than changed here.
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
- [x] A CLI that sends neither parameter still completes `login` end to
      end against a current backend.
- [x] A browser login whose callback carries no `state`, or one that does
      not match its cookie, is refused before any user record is touched.
- [x] `wafflebase login` against a backend that ignores both parameters
      fails closed with a message naming the cause (it does **not**
      complete — see the plan bullet above; this replaces the earlier
      criterion, which asked for behavior that would reopen the hole).
