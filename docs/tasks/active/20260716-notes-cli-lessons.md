# Notes CLI — lessons

## What was non-obvious

- **Notes are structurally unlike docs/slides.** A note's whole content is a
  single markdown string in one Yorkie `Text` at `root.content` (CodePair
  byte-compatible), not a block/tree. So the CLI/REST content shape is just
  `{ content: string }` and there is **no lossy serialization** — the thinnest
  of the three document pipelines. Don't reach for a serializer; the file bytes
  *are* the content.

- **The v1 REST create endpoint silently downgraded unknown types to `sheet`.**
  `api/v1/documents.controller.ts` coerced anything not `doc`/`slides` to
  `sheet`, so `type: 'note'` never created a note over the public API. Any new
  document type needs this allow-list widened, not just the docKey prefix.

- **The shared content controller only dispatched `doc`/`slides`.** Notes
  needed a third arm in `docs-content.controller.ts` (`loadContentType`, GET,
  PUT, `sniffBodyShape`, a validator) plus a tiny `note-content.ts` Text
  reader/writer. `note-<id>` docKey + `parseYorkieDocKey` already knew notes,
  but nothing read/wrote the content.

- **Body-shape sniffing order matters.** Note bodies are `{ content: string }`.
  Sniff `slides`/`blocks` arrays *first*, then `typeof content === 'string'`
  last — docs/slides bodies never carry a top-level string `content`, so it's a
  safe discriminator only when checked last. Consequence: a non-string
  `content` never routes to the note arm, so `assertValidNoteBody`'s string
  check is defensive/unreachable via sniff — the test had to assert the generic
  "must contain blocks/slides/content" 400, not the note-specific message.

## Guard on capability, not `toString` (review F2)

`readNoteRoot` first guarded `typeof text.toString !== 'function'` — true for
**every** object, so a mis-materialized content value (the `@yorkie-js/sdk` vs
`@yorkie-js/react` class-identity gap the frontend's `ensureText` repairs)
would serialize as `"[object Object]"`. Guard on the **distinguishing
capability** (`.edit`, which only a real Yorkie `Text` has), matching
`writeNoteRoot` and the frontend. Rule: when guarding "is this the CRDT I
expect?", check a method unique to that CRDT, never `toString`.

## The create branch needs a live-Yorkie test (review F4)

`writeNoteRoot`'s create branch (`root.content = new Text()` then
`text.edit(...)` in the **same** `doc.update`) is the primary path for
importing a brand-new note, but it cannot be unit-tested: a real `Text` needs a
live document context, and a fake stub only exercises the edit branch. The only
honest coverage is a Yorkie-attached e2e (`RUN_YORKIE_INTEGRATION_TESTS`),
modeled on `docs-cli-roundtrip.e2e-spec.ts`. The create+edit-in-one-update
pattern is idiomatic Yorkie and verified working — but prove it with an attach,
don't assume it from a green unit suite.

## Local env drift bites integration tests

The notes e2e (and the pre-existing docs e2e) failed locally with
`project not found: PVdXqunTdAkBFpANyxDQaS` — a stale `YORKIE_PUBLIC_KEY` in
`packages/backend/.env` pointing at a project absent from the freshly-restarted
docker Yorkie. **Before diagnosing a new e2e as broken, run a sibling e2e**:
if the existing one fails identically, it's env drift, not your code. Override
with `YORKIE_PUBLIC_KEY= YORKIE_SECRET_KEY=` to use docker Yorkie's default
project. (Ties to [[feedback_dont_overdiagnose_env]].)

## Mirror the newest sibling namespace

`slides` (the most recent parallel doc type) was the right template for the
CLI wiring: `register*Command` shape, `--format` funneled to the global option
(never redeclared per-command), `getOptionValueSourceWithGlobals('format')` to
tell an explicit flag from the default in export, the IO-surface split for
testable orchestrators, and the `--replace`/`--yes` confirm gate. Copying the
established shape kept the diff reviewable and the tests parallel.

## Known duplication accepted (review F5/F6)

`NotesContentIO`/`NotesImportIO` triplicate the docs/slides IO helpers. This
is the codebase's *existing* per-type duplication — not new debt introduced
here. Extracting a shared helper is a real cleanup but touches docs+slides too,
so it belongs in a batched CLI-internals refactor, not smuggled into a feature
PR. (Ties to [[feedback_batch_larger_work_units]].)
