# CLI: validate upstream error bodies before forwarding them (#655)

## Problem

Six CLI command paths forward an upstream error body verbatim after a
truthiness test (`if (body?.error)`). Every Express/Nest 404/500 body
(`{message, error: "Not Found", statusCode}`) passes that test, so the
CLI prints a body where `error` is a **string** — no `code`, no
`message` — while `packages/cli/README.md` documents the error contract
as `{"error":{"code":"…","message":"…"}}`. Structurally wrong JSON is
worse than prose: a consumer has no signal not to trust the shape.

Sites:

- `packages/cli/src/commands/docs.ts:192`, `:254`
- `packages/cli/src/commands/slides.ts:151`, `:204`
- `packages/cli/src/commands/notes.ts:145`, `:202`

## Plan

- [x] Add a shared guard next to `outputError` (`src/output/formatter.ts`,
      which already owns the envelope contract) that forwards the upstream
      body only when `error` is an object with a string `code`, and
      otherwise throws `HTTP <status>` so the existing `catch` routes it
      through `outputError`.
- [x] Replace all six sites with the helper (kills the local casts that
      asserted a shape nobody checked).
- [x] Tests: unit tests for the guard (envelope forwarded; Express 404
      body, `null`, string body, non-string `code` all rejected) plus a
      command-level regression driving `docs content` / `slides content` /
      `notes content` through commander with a stubbed fetch.

## Acceptance criteria

- An Express-shaped 404 body reaches stderr as
  `{"error":{"code":"ERROR","message":"HTTP 404"}}`, exit code 1.
- A backend-shaped body (e.g. `TYPE_MISMATCH`) is still forwarded
  verbatim, exit code 1.
- All six sites share one helper.

## Non-goals

- Any change to the backend's error bodies.
- Touching other command paths (sheets/cells/files) that do not have
  this pattern.
