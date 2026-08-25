# PR #786 — merge-conflict resolution

Branch: `agent/661-cli-error-envelope-command` → `main`
PR: https://github.com/wafflebase/wafflebase/pull/786

## Context

The branch carries two bodies of work: its stated scope (#661 — the CLI
error envelope as one line carrying `command`) and a CLI login-hardening
epic layered on top between Aug 12–15. While it sat open, `main` landed
overlapping work through sibling PRs:

| main PR | What it changed |
| ------- | --------------- |
| #770 | `forwardUpstreamError` / `upstreamErrorJson` / `safeEnvelope` — status-derived codes, upstream-text clamping |
| #695 | Routed `status` / `ctx list` through the output formatter |
| #648 | `LoginError` / `classifyLoginFailure` — system failures exit 2 |

`main` is newer on every one of those files, so the resolution takes
main's structure and re-applies the branch's *intent* on top of it,
rather than the reverse.

## Decisions

- **Error envelope** — keep main's classification and clamping; thread
  the branch's `command` attribution through it. The branch's
  `backendErrorEnvelope` is dropped: main's `safeEnvelope` +
  `upstreamMessage` cover the same ground with bounds the branch lacked.
- **`command` is never forwarded** — the branch's rule survives inside
  `safeEnvelope`: an upstream `error.command` is deleted and ours written
  last, so a server cannot relabel which command failed.
- **Login** — keep main's `runLogin` / `LoginError` structure verbatim,
  including its deliberate "login prints prose, not JSON" decision (#648,
  newer than the branch's opposite call). Graft on only what main lacks.

## Checklist

- [x] `packages/cli/src/output/formatter.ts` — merge both error paths
- [x] `docs.ts` / `notes.ts` / `slides.ts` — `forwardUpstreamError(res, this)`
- [x] `docs/import.ts` / `notes/import.ts` / `slides/import.ts` — `upstreamErrorJson(res, command)`
- [x] `files/upload.ts` / `files/download.ts` — same, plus main's "no file content" message
- [x] `packages/cli/README.md` — errors section
- [x] `packages/cli/src/commands/login.ts` — main's structure + `armLaunch` + `announceLoginUrl`
- [x] `docs/design/cli.md` — Error Matrix + §9 emitter list
- [x] `docs/design/rest-api.md` — threat-model rows
- [x] `packages/backend/README.md` — de-duplicate the duplicated `COOKIE_SECURE` block
- [x] `packages/cli/test/output.test.ts` — reconcile both suites
- [x] `pnpm cli test` + `pnpm verify:fast` green
- [x] Push to the PR branch

## Review

**Resolution.** 14 conflicted files. The CLI error path took main's
classification (`upstreamErrorCode`, `exitCodeFor`) and clamping
(`safeEnvelope`) and gained the branch's `command` attribution:
`forwardUpstreamError(res, this)` for the throwing commands,
`upstreamErrorJson(res, command)` for the orchestrators. The branch's
`backendErrorEnvelope` was deleted — `safeEnvelope` + `upstreamMessage`
already read Nest's top-level `message` and a `message[]`, with bounds the
branch's version did not have. Its one rule that main lacked moved into
`safeEnvelope`: an upstream `error.command` is deleted and ours written
last.

`login.ts` kept main's `runLogin` / `fetchLoginSession` / `LoginError`
structure verbatim, including "login reports prose" (#648). Grafted from
the branch: `armLaunch` (the opener gets a loopback launch token, so the
nonce and PKCE challenge never enter a child process's argv),
`announceLoginUrl` (headless stderr → `0600 login-url.txt`, deleted when
the login settles), and the hardened `openBrowser` that absorbs the
child's async `error` event. Its two "login emits a JSON envelope" tests
became prose + exit-code assertions.

**Beyond a literal resolution** (each a contradiction the merge exposed):

- `ctx switch` reported `UNAUTHORIZED` while `ctx list` reported
  `NOT_LOGGED_IN` for the identical condition, and `cli.md` §10 states
  there is deliberately no `UNAUTHORIZED` code. Aligned on
  `NOT_LOGGED_IN`.
- `packages/backend/README.md` documented `COOKIE_SECURE` twice, in two
  different wordings — a pre-existing duplicate on the branch, not a merge
  artifact. Folded into one.
- `cli.md`'s "The printed OAuth URL is a credential" paragraph described
  behavior `armLaunch` replaced; rewritten to point at the launch-token
  section rather than contradict it.
- `auth.controller.spec.ts`'s cookie cases read `NODE_ENV`, but the branch
  made `GITHUB_CALLBACK_URL` win over it. The spec therefore passed in CI
  and failed on any developer with a `packages/backend/.env`. The describe
  now clears the variable.

**Verification.** `pnpm cli test` — 39 files / 707 tests pass.
`pnpm verify:fast` — exit 0, no failures across the workspace.
