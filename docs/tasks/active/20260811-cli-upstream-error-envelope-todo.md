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
      otherwise throws an `UpstreamHttpError` (`code = 'HTTP_ERROR'`,
      message `HTTP <status>[: <upstream message>]`) so the existing
      `catch` routes it through `outputError`.
- [x] Replace all six sites with the helper (kills the local casts that
      asserted a shape nobody checked).
- [x] Then every *other* `!res.ok` branch too. They threw
      `new Error("HTTP <status>")`, which flattens a real backend envelope
      — the client's own 401 `SESSION_EXPIRED` above all — to
      `{code: "ERROR"}`, so the code an agent branches on depended on which
      subcommand it ran. Sites: `commands/docs.ts` (×5),
      `commands/notes.ts` (×5), `commands/slides.ts` (×5),
      `commands/cells.ts` (×4), `commands/tabs.ts` (×3),
      `commands/files.ts` (×4), `commands/api-keys.ts` (×3),
      `commands/sheets-import.ts`, `commands/sheets-export.ts` (which
      additionally lifted `error.message` out and dropped the `code`).
- [x] Tests: unit tests for the guard (envelope forwarded; Express 404
      body, `null`, string body, non-string `code` all rejected) plus a
      command-level regression driving `docs content` / `slides content` /
      `notes content` through commander with a stubbed fetch.
- [x] Same rule for the import/upload/download paths, which report through
      an injected `io.stderr` + exit code instead of throwing:
      `upstreamErrorJson()` returns the envelope verbatim or the
      `HTTP_ERROR` envelope their skill files already promise. Sites:
      `src/docs/import.ts` (×3), `src/notes/import.ts` (×3),
      `src/slides/import.ts` (×3), `src/files/upload.ts`,
      `src/files/download.ts` — each previously printed
      `res.data ?? { error: { code: 'HTTP_ERROR' } }`, which only
      substituted the envelope for a *null* body.

## Acceptance criteria

- An Express-shaped 404 body reaches stderr as
  `{"error":{"code":"HTTP_ERROR","message":"HTTP 404: <upstream
  message>"}}`, exit code 1 — the **same** code on every path
  (content/export as well as import/upload/download), because both
  describe the identical condition and an agent must not have to branch
  on which command it ran to know what the code will be.
- A backend-shaped body (e.g. `TYPE_MISMATCH`, `SESSION_EXPIRED`) still
  reaches stderr with the upstream's **own `code`**, exit code 1, from
  *every* command — not just the six that already did. Forwarding is
  bounded rather than byte-for-byte: the `code` is never rewritten, but
  the surrounding text is capped (`code` 80 chars, `message` 500 chars,
  an HTML `message` replaced by `HTTP <status>`, sibling fields dropped
  past 4 KB), because a forwarded body is upstream-controlled content
  printed into an agent's stderr. Documented in `packages/cli/README.md`
  and `docs/design/cli.md` §10.
- No id the client interpolates into a request path — workspace,
  document, tab, cell ref — can leave its own path segment. `fetch`
  resolves `..`, so an unencoded id could otherwise send the command's
  method and the session's bearer token at an unrelated endpoint. This
  holds for the **whole** browser client too, not only `api/documents.ts`:
  workspaces, folders, share links, datasources, files, analytics, the
  Miro import and the sheet image upload all route ids through `seg()`,
  pinned by `packages/frontend/src/api/url.test.ts`.
- An image `src` cannot aim an export at the local network, and cannot do
  it via a redirect either: the fetcher takes the hops itself
  (`redirect: 'manual'`, re-checked per `Location`, capped at 5) and
  normalizes a hostname before comparing it, so `localhost.` is refused
  like `localhost`. A deployment that genuinely serves images from an
  internal host stays exportable through `WAFFLEBASE_IMAGE_HOSTS`, which
  the refusal message names.
- Every CLI path that prints an upstream body shares one guard
  (`isErrorEnvelope`) in `src/output/formatter.ts`.
- `packages/cli/README.md` and `docs/design/cli.md`'s error matrix
  document `HTTP_ERROR`, since it is a code agents may branch on.

## Non-goals

- Any change to the backend's error bodies.
- `login`'s workspace fetch, which reports a bespoke, actionable message
  ("Try again with `wafflebase login`") rather than forwarding a body.
