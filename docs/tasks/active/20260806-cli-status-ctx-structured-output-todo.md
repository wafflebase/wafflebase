# CLI: route `status` / `ctx list` through `output()` (#635)

## Problem

`docs/design/cli.md` §8.1 promises "All output is JSON by default. Errors
are also JSON so agents can parse success and failure uniformly." Two
commands break that contract:

- `wafflebase status` prints bare English sentences via `console.log`,
  never reads `opts.format`, and never calls `output()`.
- `wafflebase ctx list` does the same (prose `*`-marker list).
- Both silently accept `--format bogus` — no signal that the value is
  unsupported.

`status` is the first command an agent runs to decide whether to prompt
for login, so `JSON.parse` on its stdout throws at the very start of a
session.

## Approach

1. Add `parseOutputFormat()` to `src/output/formatter.ts` — validates a
   raw `--format` value against `json | table | csv` and throws an
   `Error` carrying `code = 'INVALID_FORMAT'` so `outputError()` emits a
   structured JSON body. Also give `format()` a validating `default:`
   branch so no command can `console.log(undefined)` on a bad format.
   The global `--format` flag is deliberately overloaded by
   `docs/slides/notes content|export` (`md`/`text`/`pdf`/`docx`/`pptx`),
   so validation must stay per-command — commander `.choices()` on the
   global option would break those.
2. `status`: build a flat structured payload and route it through
   `output()`. Flat (not nested) so `--format table` / `--format csv`
   render usefully — that is the documented human path now that JSON is
   the default.
3. `ctx list`: emit `[{ id, name, active }]` — exactly the shape
   `wafflebase schema ctx.list` already declares. Drop the prose
   `formatWorkspaceList` helper; `--format table` covers the human view.
4. Update the `status` response shape in `src/schema/registry.ts` to
   match what the command now emits.
5. Tests in `test/status.test.ts` / `test/ctx.test.ts` over the pure
   payload builders + `parseOutputFormat`.
6. Touch up `docs/design/cli.md` where it describes the prose output.

## Emitted shapes

`status`, logged in:

```json
{
  "loggedIn": true,
  "user": "hackerwins",
  "email": "h@example.com",
  "server": "http://localhost:3000",
  "workspaceId": "e98ff707-...",
  "workspaceName": "hackerwins's Workspace",
  "session": "valid",
  "expiresAt": "2026-08-07T00:00:00.000Z"
}
```

`status`, not logged in (still exit 0 — reporting "no session" *is* the
command succeeding):

```json
{
  "loggedIn": false,
  "message": "Not logged in. Run `wafflebase login`."
}
```

`ctx list`:

```json
[{ "id": "e98ff707-...", "name": "Team Workspace", "active": true }]
```

## Decisions

- **`status` exits 0 when not logged in.** It answered the question it
  was asked; agents branch on `loggedIn`.
- **`ctx list` exits 1 with a JSON `NOT_LOGGED_IN` error when there is
  no session.** It cannot list anything, and sibling `ctx switch`
  already errors + exits 1 in that state. This is a behavior change
  beyond the literal ask; disclosed in the PR.
- Keep `ctx switch` prose as-is: out of scope for this issue.

## Checklist

- [x] `parseOutputFormat()` + validating `format()` default in
      `src/output/formatter.ts`
- [x] `status` routed through `output()`; `--format` honoured; bogus
      rejected
- [x] `ctx list` routed through `output()`; `--format` honoured; bogus
      rejected
- [x] `schema` registry `status` response updated
- [x] unit tests: status payload, ctx list payload, format validation
- [x] `docs/design/cli.md` prose references updated
- [x] draft PR opened, `Fixes #635`
- [x] `schema` wrapped in try/catch (found in self-review: it was the
      only `output()` caller without one, so `format()`'s new throw
      escaped as an uncaught exception)
- [x] `formatTable` JSON-serializes nested values (found in
      self-review: `schema --format table` printed `[object Object]`)
- [x] `packages/documentation/developers/cli.md` (published page)
      updated — it still advertised the deleted `*` active marker

## Review round 2 (panel changes-requested)

- [x] `api-keys` regression tests pin "validate `--format` before the
      side effect" by asserting `fetch` is never called
      (`test/api-keys.test.ts`)
- [x] `INVALID_FORMAT` / `NOT_LOGGED_IN` added to the §10 error matrix;
      exit-code prose clarified (a missing local session is user error)
- [x] every `--format` rejection now raises `InvalidFormatError`, so
      `docs`/`slides`/`notes` `content`/`export` report `INVALID_FORMAT`
      too — the §8.1 promise is now true
- [x] CSV output neutralizes spreadsheet formula prefixes (`=`/`+`/`-`/
      `@`/tab/CR → leading `'`), plain signed numbers untouched
- [x] CLI OAuth loopback callback bound to a per-attempt nonce echoed
      back as `state` (backend `cli-auth.store` + callback redirect);
      rejects non-GET and `Origin`-bearing requests
- [x] `cells batch` parses `--data`/stdin inside the try, so malformed
      JSON is a structured error body, not an unhandled rejection

## Review round 5 (panel changes-requested)

- [x] `formatCsv` takes a required `neutralizeFormulas` option; the
      `--format csv` render path passes `true`, `sheets export
      --file-format csv` passes `false`, so an exported formula
      re-imports as a formula (`test/sheets-export.test.ts`)
- [x] CSV quoting covers `\r` and `\t`, closing the embedded-CR bypass
      that let a value forge a new record past the neutralizer
- [x] loopback callback refusals are reported (stderr + browser tab +
      timeout error), distinguishing "no `state`" (backend older than
      the CLI) from "`state` mismatch"; `startCallbackServer` takes an
      injectable `timeoutMs` so that is testable
- [x] `GitHubAuthGuard.canActivate` covered — the nonce chain's entry
      point was untested (`github-auth.guard.spec.ts`)
- [x] `rest-api.md` §7 documents the `nonce` param, the echoed `state`,
      and the version coupling; risk table gains the loopback-CSRF row
      and records the **web** OAuth `state` gap as open
- [x] `cli.md` §8.1 scopes the `output()` claim to structured results
      and the neutralization to the render path; §10 no longer implies
      `ctx switch` emits `NOT_LOGGED_IN`
- [x] `formatTable` JSON-serializes nested values in array rows too
- [x] stale comments corrected (`cells.ts` on `runCli`'s envelope,
      `scripts/agent/hunt-workspace.mjs` on `status` ignoring `--format`)

Not fixed, with reasons:

- **Web OAuth `state` (security, major)** — real and pre-existing
  (`github.strategy.ts` sets `state` only for CLI logins), but out of
  this PR's diff and not a CLI change. A fix needs a state store that
  survives restarts and spans replicas; the CLI's in-memory map does
  neither. Recorded in the `rest-api.md` risk table for a separate PR.
- **Scope creep (design-fit, major)** — accurate as a description, but
  the OAuth nonce, CSV neutralization and `cells batch` restructure are
  this panel's own round-2 requests (see "Review round 2" above).
  Reverting them to satisfy round 5 would re-open round 2.
- **`cells batch --dry-run` outside the try/catch (minor)** — every
  dry-run call site is structured that way (`cells.ts:52-60` for `cells
  set`), so this is not a `batch`-specific regression. Making
  `--dry-run` validate `--format` is a change across every command;
  deliberately not bundled here.

## Review round 6 (panel changes-requested)

- [x] loopback callback no longer refuses a request for carrying an
      `Origin` header — a browser/extension/proxy may attach one
      (`Origin: null`) to the genuine redirect chain, and since a
      refusal never settles the wait that refusal hangs the login for
      the whole timeout. The nonce is the defense; only non-GET is
      still refused (`login.ts`, `test/login.test.ts`)
- [x] the callback wait is 3 minutes, not 30 seconds: the browser leg
      now includes a confirmation click plus, on a cold browser, a
      GitHub sign-in. Still inside the backend's 5-minute state TTL
- [x] **web** OAuth `state` closed (the round-5 "not fixed"): every
      login path now carries one. The browser flow uses a double-submit
      cookie — secret in a short-lived httpOnly
      `wafflebase_oauth_state`, its SHA-256 as `state` — so it needs no
      store and works across replicas and restarts, which is what round
      5 said blocked the fix. A callback with no `state` is a 400
      (`oauth-state.ts`, `github-auth.guard.ts`, `auth.controller.ts`)
- [x] `GET /auth/github?mode=cli&port=…` gated on a click:
      `CliLoginConfirmMiddleware` answers with a confirmation page whose
      Continue link pairs a one-time secret with an httpOnly cookie
      (`X-Frame-Options: DENY`). A bare navigation can no longer mint a
      code for the victim at an attacker-chosen loopback port. The guard
      mints CLI state only for a confirmed request, so an unwired gate
      degrades to a browser login rather than failing open
- [x] CSV neutralization decides on the value an importer will *see*:
      leading whitespace (space, tab, CR, U+00A0, BOM) is skipped before
      the formula test, so ` =HYPERLINK(…)` no longer slips through a
      trim-on-import
- [x] `sheets export` neutralizes by **default**; `--raw` opts out for
      the export → import round trip. That file is the one most likely
      to be opened in Excel, and every cell in it is settable by any
      co-member (`sheets-export.ts`, recipe + published docs updated)
- [x] `cli.md` §8.1 counts `files upload` among the commands that
      bypass `--format` — it renders through its own `io.stdout` seam,
      like the three importers

Rebutted rather than fixed:

- **Scope creep (design-fit, major)** — raised again. The OAuth nonce,
  CSV neutralization and `cells batch` restructure are this panel's own
  round-2 requests (see "Review round 2"); reverting them to satisfy
  the design-fit lens would re-open round 2 and contradict this round's
  own security findings, which ask for those same changes to be
  *strengthened*. Filed as a structured rebuttal on the PR.

## Review round 8 (panel changes-requested; panel now frozen)

The panel's three fix rounds were spent, and one lens (security) failed
without a verdict — its credential pool was exhausted, not a finding —
so the round-8 blocking set was worked through by hand.

- [x] `startCallbackServer` arms the wait timer only once the server is
      listening. It was armed during setup, and the only handle that
      clears it is the `close()` returned when the promise *resolves*,
      so both rejection paths (an unusable address, a non-retryable
      `listen` error) leaked it: the timer held the process open for the
      full three minutes and then rejected a `callbackPromise` nobody on
      that path awaits — an unhandled rejection minutes after the real
      error was already printed (`login.ts`,
      `test/login-listen-failure.test.ts`)
- [x] a browser login that fails its `state` check is redirected to
      `FRONTEND_URL/login?error=oauth_state` instead of throwing a 400.
      Losing the state needs no attacker — the cookie lives ten minutes,
      which a first-time sign-up with 2FA can outlast, and a second
      login tab overwrites the first tab's — and the frontend had no
      error path, so the user landed on the *backend* origin looking at
      raw Nest JSON. Refusing the login and returning the user somewhere
      they can retry are independent; no session is issued either way.
      The sign-in page now reads `?error=` and says so
      (`auth.controller.ts`, `login-form.tsx`, `login/page.tsx`)
- [x] a repeated `?state=` (which arrives as an array) is normalized to
      the same refusal instead of reaching `isWebOAuthState`, where
      `.startsWith` on an array was a TypeError — a 500 in place of the
      refusal
- [x] `sheets export --raw` registered in the schema registry — the
      agent-facing interface omitted a flag that changes output
      semantics. Pinned by a **parity** test that walks commander's own
      option list for the command, so the next flag added fails there
      rather than shipping undiscoverable (`registry.ts`,
      `test/sheets-export.test.ts`)
- [x] `GitHubStrategy.authenticate` covered: it reads `__oauthState` and
      forwards it as `state`, the single hinge both login paths depend
      on. The guard spec asserted only that the guard *sets* the key, so
      a spelling mismatch would have made every login reach GitHub
      stateless — and every callback be rejected — with a green suite
      (`github.strategy.spec.ts`)
- [x] the confirmation page's Continue link is asserted to carry `port`
      and `nonce`. It is the only path by which the CLI's per-attempt
      nonce survives the confirmation hop; dropping it breaks CLI login
      silently (the loopback refuses "no `state`" until the timeout)
      (`cli-login-confirm.middleware.spec.ts`)
- [x] `docs/design/backend.md` folds in the backend architecture change:
      the AuthModule middleware, the now-mandatory callback `state` with
      both flows' vocabularies, and the two new cookies in the cookie
      table. `packages/backend/README.md`'s auth flow and endpoint table
      follow
- [x] the `--raw` contract's stale consumers updated: the export skill
      doc (which documented verbatim CSV) and the agent round-trip
      charter (which asserted two identities the default guard makes
      false)

Rebutted rather than fixed:

- **Scope creep (design-fit, major)** — raised for the third round. The
  answer is unchanged: the OAuth work, CSV neutralization and `cells
  batch` restructure are this panel's own round-2 requests (see "Review
  round 2"). Reverting them re-opens round 2.
- **Web OAuth `state` deferral** — no longer applicable. Round 6 closed
  the gap and rewrote the `rest-api.md` risk row; round 8 only corrects
  that row's now-stale "a callback with no `state` is a 400".
