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

Executed with subagent-driven development: one implementer per task, a scoped
review after each, then a whole-branch review. 18 commits.

### A gate can be green and prove nothing

`pnpm verify:fast` passes through **any** frontend type error. `pnpm frontend
lint` is not type-aware (no `parserOptions.project`) and `pnpm frontend build`
is `vite build`, which uses esbuild and strips types without checking them.
There is no `typecheck` script in `packages/frontend/package.json` at all.

The trap has a second layer: `npx tsc --noEmit` in that package reports "No
errors found", because the root `tsconfig.json` is `{"files": [],
"references": [...]}` and checks nothing. Only `npx tsc -p tsconfig.app.json
--noEmit` looks at the source — and it reports 151 pre-existing errors.

Requiring that command against a saved baseline on every frontend task caught
**three** real type errors the gate waved through: a `Record<DocumentType, …>`
left a key short (which was also a runtime crash), an excess-property error on
a payload literal, and a `Document.fileId` field missing from the frontend type.

**Rule:** before trusting a verification lane, read what it actually runs. A
lane that cannot fail on the class of defect you care about is not evidence.

### Widening a union is a breaking change to every exhaustive consumer

Adding `"file"` to `DocumentType` broke `TYPE_META`, a `Record<DocumentType,
…>` with seven keys — a type error *and* a `TypeError: Cannot destructure
property 'Icon' of 'undefined'` that takes down the whole documents list on the
first `file` row. The plan had scheduled that entry five tasks later.

**Rule:** when widening a union, grep for `Record<ThatUnion`, exhaustive
switches, and lookup maps in the same commit. The widening and the consumers
are one change, not two.

### Task boundaries have to respect behaviour, not just tests

Twice the plan split work so that an intermediate commit type-checked and
tested green while being behaviourally broken — the `file` classify fallback
without the worker branch that handles it (a dropped `.zip` would hang holding
a concurrency slot), and the union widening without its `TYPE_META` key. Both
were caught, one by a pre-flight scan and one by review.

**Rule:** when splitting a plan, ask of each boundary "if someone stopped
here, what would a user see?" — not "do the tests pass here?".

### The bugs that survive per-task review are the ones that span tasks

Every one of the eight tasks passed its own scoped review. The whole-branch
review then found five blocking defects, four of them collisions between tasks
that no single-task reviewer could see:

- `stripExt` built a `RegExp` from the filename extension. Safe while
  extensions came from a nine-entry map; a crash (`main.c++` → "Nothing to
  repeat") once any extension was allowed. The change that broke it was three
  tasks away from the code.
- `fileSize`/`mimeType` were assigned only inside `if (!fileId)`, while a
  different task had made the retry loop re-enter with `fileId` already set —
  so every 429 retry wrote NULLs. Two correct decisions, one broken result.
- The download filename broke in all three download paths, each for a
  different reason, all rooted in one task moving the extension out of the
  title.

**Rule:** budget for a whole-branch review even when every task was reviewed.
It is not a formality — it is the only pass that sees the seams.

### Removing a redundant check can arm a distant bug

Dropping the `POST /files` MIME allow-list was correct — the real control moved
to serve time. But that allow-list had been the reason an unrelated,
unauthenticated route (`GET /images/:id`, which echoes the stored ContentType
with no `Content-Disposition` and a one-year public cache) was harmless: the
files bucket could only ever hold five safe MIME types. Afterwards, a
shared-bucket misconfiguration would have been live stored XSS on the backend
origin.

**Rule:** when deleting a check, ask what *else* was relying on the invariant
it happened to provide — not just what it was written for.

### Tests can pass for the wrong reason at the wiring layer

`document-file.controller.spec.ts` covered blob serving with `type: 'pdf'` and
a stored `application/pdf` — a fixed point of both the old echo-the-stored-type
code and the new derive-from-type code. Both cases passed identically before
and after the security change, so nothing proved the controller had actually
been rewired.

**Rule:** a regression test must fail against the old implementation. If you
cannot say how it would fail, it is not covering the change.

### No database meant the flow was never run

Two manual smoke steps were skipped for lack of a database. Review caught what
they would have: a shared `file` link whose card said "use Download in the
header" when that header had no download control, leaving an anonymous
recipient with no way to get the file. The final review found the same class of
defect again in the download filenames.

**Rule:** when substituting unit tests for a manual end-to-end check, they
cover the units, not the flow. Say so explicitly, and treat the flow as
unverified until someone runs it.
