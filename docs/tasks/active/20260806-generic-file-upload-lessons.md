# Generic File Upload — Lessons

Paired with
[`20260806-generic-file-upload-todo.md`](20260806-generic-file-upload-todo.md).
Design: [`docs/design/generic-file-upload.md`](../../design/generic-file-upload.md).

## Design phase

### A CRDT document key is an identity, not a label

The tempting model for "support any file" was to collapse `pdf` and `image`
into one `file` type and dispatch on `mimeType`. Every cost that looked
expensive turned out cheap — one reversible `UPDATE`, no external API break
(`POST /api/v1/.../documents` only accepts the CRDT types), ~8 frontend
comparisons — and the one that killed it looked like an afterthought:
`yorkieDocKey(type, id)` derives the Yorkie key from `type`, and a Yorkie
document key cannot be renamed. Collapsing the type would strand every existing
`pdf-<id>` comment thread behind an unreachable key.

**Rule:** before changing a `type`/kind discriminator, check whether anything
derives an *external identity* from it — CRDT keys, blob keys, URLs, cache
keys. Renamable internals are cheap; identities are not.

### Name what a field means before deciding it needs a new value

Adding an eighth `Document.type` looked like a fallback hack until the field
was defined: `type` is a **viewer-routing key**, not a file format. The code
already worked that way (`getDocumentPath` is a switch to routes) — it had just
never been written down. Once stated, `file` = "blob with no dedicated viewer"
is a rule, and a future `video` type becomes purely additive.

**Rule:** when a change to an enum feels like a hack, suspect the enum's
meaning is undocumented rather than the change being wrong.

### Put the guard where the decision is decidable

The instinct for "accept arbitrary files" was an extension blacklist
(`.exe`, `.sh`, …). It does nothing: storing an executable is harmless, and
renaming defeats the list. The actual failure mode is *serving* — an uploaded
`.html` echoed back with its stored `Content-Type` and
`Content-Disposition: inline` executes in the backend origin with the session
cookie in scope, and `nosniff` does not stop an explicit `text/html`.

Moving the rule to the response — derive `Content-Type` from the document type,
never echo storage — removed the need to trust client MIME at all.

**Rule:** when a validation list is hard to make complete, check whether the
decision can be moved to a point where no untrusted input is involved.

### Don't write "current behavior" into a design from memory

The design's error-handling section claimed over-cap files fail before the
request "as today's policy for oversized PDFs". `upload-queue.ts` has **no
client-side size check** — the file uploads in full and the backend rejects it.
Caught only by grepping during the plan's self-review. The fix turned into a
real improvement (a 2 GB video should not cross the wire to fail), but the
design would have shipped a false statement.

**Rule:** every "today the code does X" sentence in a design needs a grep
behind it before it is committed.

### Reading adjacent code finds bugs the ticket didn't mention

Tracing where a `file` share link would route surfaced that `image` share links
already break: `shared-document.tsx` early-returns only for `pdf`, and `image`
matches no branch in the `docKey` ternary, so it falls to `sheet-${id}` and
renders an empty spreadsheet over a real image. Reachable — `ImageFileLayout`
exposes `ShareDialog`. `ResolvedShareLink["type"]` omitting `"image"` is the
type-level tell, while the backend returns `link.document.type` verbatim.

**Rule:** when adding a case to a dispatch chain, enumerate the existing cases
against the full set of possible values. A missing one is a live bug, not a
future risk.

## Implementation phase

_Filled in during implementation._
