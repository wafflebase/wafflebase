# CLI: produce exit code 2 for system errors (#586)

## Problem

`packages/cli/README.md` and `docs/design/cli.md` both document a
three-value exit contract — `0` success, `1` user error, `2` system
error (network, auth) — and explicitly invite agents to branch on the
exit code without parsing stderr. Exit code `2` is never produced:
`outputError()` sets `process.exitCode = 1` on both of its branches and
nothing else in `packages/cli/src/` sets `2`. An unreachable server and a
malformed cell reference are therefore indistinguishable to a caller.

Decision: **implement** the contract (issue option 1) rather than retract
it. The docs invite external callers to depend on it, and the
classification is cheap — the CLI already funnels every API call through
one `HttpClient`.

## Approach

Classify at the throw site, map class → exit code at the output site.

1. `packages/cli/src/errors.ts` (new)
   - `EXIT_USER_ERROR = 1`, `EXIT_SYSTEM_ERROR = 2`.
   - `class SystemError extends Error` carrying `code` (kept by the
     existing `errorCode()` pass-through) and `exitCode = 2`.
   - `httpError(status, message?)` — `401/403` → `AUTH_ERROR`, `>= 500`
     → `SERVER_ERROR`, everything else a plain `Error` (user error).
   - `exitCodeForStatus(status)` for the import flows, which return an
     exit code instead of throwing.
   - `fetchOrThrow(url, init, impl?)` — turns a transport-level `fetch`
     rejection into `SystemError('NETWORK_ERROR')`.
   - `exitCodeFor(error)` — reads a numeric `exitCode`, else `1`.
2. `output/formatter.ts` — `outputError` uses `exitCodeFor(error)` on
   both branches (quiet included).
3. `client/http-client.ts` — every `fetch` goes through `fetchOrThrow`.
4. Command throw sites — the 31 `throw new Error(\`HTTP ${res.status}\`)`
   become `throw httpError(res.status)`; message text is unchanged.
5. `docs/import.ts`, `slides/import.ts`, `notes/import.ts` — HTTP
   failures return `exitCodeForStatus(res.status)`.
6. `commands/login.ts` — the auth command itself: network failures and
   failing auth endpoints exit `2`.
7. Docs — README + `docs/design/cli.md` state that 5xx counts as a
   system error too, and name the codes.

## Scope taken on beyond the exit contract

The exit-code work is items 1-7 above. Three security fixes landed on the
same branch and are recorded here rather than left unexplained, because
they touch files (`packages/backend/src/auth/*`) the original Approach
does not name:

8. **CLI login nonce** (`login.ts` + `github-auth.guard.ts`) — reached
   through item 6: `login` was being rewritten for its exit codes, and
   the loopback callback it drives accepted any `?code=` that found the
   port.
9. **Web OAuth `state`** (`github-auth.guard.ts`, `auth.controller.ts`,
   new `cookies.ts`) — hardening the CLI half of `/auth/github` made the
   *web* half's missing `state` visible: passport-oauth2 with no store
   installs a `NullStore` that verifies everything, so the callback
   minted a session for any code presented to it. Leaving a known login
   CSRF in a guard this branch was already editing was not an option;
   splitting it into its own PR would have meant two branches editing
   the same two files.
10. **Browser binding on the `?mode=cli` entry** — a cross-site-initiated
    navigation could start a CLI round trip in the victim's browser with
    an attacker-chosen loopback port. Refused via `Sec-Fetch-Site`, plus
    a per-flow state cookie. An earlier round deferred this to PR #786,
    which ships a larger version (consent interstitial, PKCE); that PR
    is not in this tree, so the hole was live. The version here is
    deliberately minimal so #786 can replace it wholesale.

## Non-goals

- No change to the error body shape (`{"error":{"code","message"}}`)
  beyond the more specific `code` values that already flow through
  `errorCode()`.
- No retry/backoff on system errors.

## Checklist

- [x] `src/errors.ts` with the classification helpers
- [x] `outputError` maps error class → exit code
- [x] `HttpClient` raises `NETWORK_ERROR` on transport failure
- [x] Command HTTP throw sites classified
- [x] Import flows return the classified exit code
- [x] `login` exits 2 on network/auth failure
- [x] Unit tests: `test/errors.test.ts`, extended `test/output.test.ts`
- [x] README + design doc updated
- [x] Command-level exit codes (`test/command-exit-codes.test.ts`)
- [x] API-key endpoints share `request()`'s 401 refresh-and-retry
- [x] Nonce-bound login callback (CLI + guard, both fail-closed, specs)
- [x] Image `src` gate: scheme allowlist, resolved-address check,
      per-redirect-hop revalidation
- [x] DNS-rebinding pin on every image hop (`pinnedAgent`), exercised
      end to end through a name that cannot resolve
- [x] Egress proxies honored (`http_proxy` / `https_proxy` / `all_proxy`
      / `no_proxy`) instead of being overridden by the pin
- [x] Login timeout diagnostic made invariant — an injected nonce-less
      callback can no longer steer the operator toward the downgrade
      flag
- [x] `runLogin` driven by tests: nonce reaches the OAuth URL,
      `--allow-unbound-callback` reaches the listener
- [x] A 2xx the CLI cannot use (no `id`, no bytes) exits `2`
- [x] Address pin carried *through* an egress proxy (URL rewritten to a
      gated address, original `Host`/SNI preserved), with a
      once-per-run announced fallback for a proxy that refuses an
      address literal
- [x] Browser binding on `/auth/github`: cross-site-initiated logins
      refused, per-flow `__Host-` state cookie for web *and* CLI,
      constant-time compare exercised at equal length
- [x] `__oauthState` guard→strategy hand-off covered on both sides
