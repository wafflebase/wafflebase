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

- [x] Review round: narrow the image-fetch server exemption from the whole
      host to the configured **endpoint** (host + port, either scheme), so
      document content cannot aim an export at another service on the
      operator's machine; make the exporters' per-image tolerance opt-in
      via `onImageError` (CLI opts in, browser keeps the throw it had) and
      extend it to `exportPptx`, which had none; correct the README's
      `Host` claim to the `Host: <ip>` reality; fold the behaviour into
      `docs/design/docs/docs-pdf-export.md` and `docs-docx-import-export.md`
      rather than leaving it recorded only in the CLI's doc.

## Acceptance criteria

- An Express-shaped 404 body reaches stderr as
  `{"error":{"code":"HTTP_ERROR","message":"HTTP 404: <upstream
  message>"}}`, exit code 1 — the **same** code on every path
  (content/export as well as import/upload/download), because both
  describe the identical condition and an agent must not have to branch
  on which command it ran to know what the code will be. After the merge
  with #648 the status also names the class: 401/403 report `AUTH_ERROR`
  and 5xx `SERVER_ERROR`, both exiting `2`.
- A backend-shaped body (e.g. `TYPE_MISMATCH`, `SESSION_EXPIRED`) still
  reaches stderr with the upstream's **own `code`**, exiting the class of
  its status (`exitCodeForStatus`), from
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
  it via a redirect either. **Superseded on `main`:** #648 landed its own
  gate for exactly this (`assertFetchableImageUrl` + `pinnedAgent`), and
  the merge below keeps `main`'s, so this branch no longer carries an
  image gate of its own.
- A refused image costs the image, not the export — for the CLI, which
  opts in by passing `onImageError` on every export path (`docs export`
  PDF/DOCX and `slides export` PPTX alike). The browser, which shares
  those exporters and has no SSRF guard, passes no reporter and keeps the
  loud failure its export UI reports.
- Every CLI path that prints an upstream body shares one guard
  (`isErrorEnvelope`) in `src/output/formatter.ts`.
- `packages/cli/README.md` and `docs/design/cli.md`'s error matrix
  document `HTTP_ERROR`, since it is a code agents may branch on.

## Non-goals

- Any change to the backend's error bodies.
- `login`'s workspace fetch, which reports a bespoke, actionable message
  ("Try again with `wafflebase login`") rather than forwarding a body.

## Merge with `main` (#648, "CLI: classify failures so system errors exit 2")

#648 landed on `main` while this branch was in review and reworked the same
files from the other end: it implemented the documented `0` / `1` / `2` exit
contract (`packages/cli/src/errors.ts`), and — reaching the same conclusion
this branch had — rewrote every `!res.ok` site and built its own SSRF gate for
export image fetching. 22 files conflicted. How each was settled:

- **The `!res.ok` branch.** `main` wrote the rule out per call site
  (`throw httpError(status)`, or an inline "if the body has `error`, print it
  and set `exitCodeForStatus`"); this branch had already factored the same
  rule into `forwardUpstreamError` / `upstreamErrorJson`. The guard is kept,
  with `main`'s classification folded *into* it: the envelope path now exits
  `exitCodeForStatus(status)` instead of a hardcoded `1`, and the
  non-envelope path throws an `UpstreamHttpError` carrying both that exit
  code and the class-appropriate code — `AUTH_ERROR` on 401/403,
  `SERVER_ERROR` on 5xx, `HTTP_ERROR` otherwise, via one `upstreamErrorCode`
  shared with `upstreamErrorJson` so the two paths still agree. A 401/403
  with no upstream wording falls back to `AUTH_FAILED_MESSAGE`, so the
  message reads the same whether `httpError()` or the guard reported it.
- **`HttpClient`.** Both branches routed the API-key endpoints through the
  shared authenticated round trip. `main`'s naming (`sendJson`,
  `apiKeysBase`) is kept as the incumbent; this branch's `seg()` pinning is
  kept on top, including the two api-key URLs.
- **The image fetcher.** `main`'s gate is strictly the stronger of the two —
  it decides per resolved address, pins the connection through an undici
  `Agent` (so `https:` is pinned too, with no `Host: <ip>` cost), gates every
  redirect hop, and handles an egress proxy. Keeping this branch's version
  would have reverted that, so `packages/cli/src/docs/image-fetcher.ts` and
  its tests are `main`'s wholesale. Only `reportSkippedImage` is carried
  over, since the `onImageError` hook this branch added to
  `@wafflebase/docs` / `@wafflebase/slides` is what the CLI export paths
  pass it to; it now redacts the `src` it prints, like every other URL the
  CLI puts on stderr.

**Dropped with this branch's gate** — worth re-adding on top of `main`'s, but
out of scope for a conflict resolution, so they are recorded here rather than
silently lost:

- [ ] Per-image `timeoutMs` (30 s) and `maxBytes` (25 MB) bounds. Which host
      an export dials and how much it sends are both decided by document
      content; `main`'s fetcher bounds neither.
- [ ] `WAFFLEBASE_IMAGE_HOSTS` — the operator-named exemption for a
      split-origin install (an internal MinIO, a reverse proxy on a second
      port). `main` exempts only the configured server's host and port.
