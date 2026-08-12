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
done as its own change.

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
      as an ordinary miss (no oracle).
- [x] Back-compat both ways: both parameters are optional on the wire, so
      a new CLI works against an old server and vice versa. A code that
      arrives with *no* `state` (what an old backend looks like) is still
      refused, but the timeout message names that cause instead of
      reporting a bare timeout.
- [x] Tests: `github-auth.guard.spec.ts` over ingestion and its bounds;
      `auth.controller.spec.ts` over the `state` echo and the four PKCE
      outcomes; `login-callback.test.ts` over the callback gate (including
      a *same-length* wrong nonce, which a length-only compare would let
      through) and over the real `login` action's wire format.
- [x] Docs: `cli.md` §3.1 login flow, `rest-api.md` §7 + risk table.

## Out of scope

- Converting the `csrf` value `CliAuthStore` mints alongside the state
  token into an enforced control, or deleting it. The state token is
  itself the opaque single-use guard; `csrf` has no reader. Noted in the
  `rest-api.md` risk row rather than changed here.
- Rotating the loopback listener onto a fixed registered port or a
  `Sec-Fetch-Site` check. The two bindings above are the RFC's own
  prescription; origin headers are advisory on a plain-`GET` navigation.

## Acceptance criteria

- [x] A callback carrying a valid-looking `code` but no/wrong `state` is
      answered `400` and never redeemed.
- [x] A code minted under PKCE cannot be exchanged without the verifier.
- [x] `wafflebase login` still completes end to end against a backend
      that ignores both new parameters.
