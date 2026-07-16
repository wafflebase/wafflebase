# Notes (Markdown) Document Type — Lessons (P1)

Design: [`docs/design/notes/notes.md`](../../design/notes/notes.md).
Plan: [`20260715-notes-markdown-type-todo.md`](./20260715-notes-markdown-type-todo.md).

Capture non-obvious findings here as implementation proceeds.

## Pre-implementation notes (from planning)

- **Store-boundary decision.** CodePair's CodeMirror↔Yorkie binding talks to the
  Yorkie `doc` directly via a CodeMirror facet. Wafflebase's hard rule (CLAUDE.md)
  requires all document behavior to go through a `Store` interface. Resolution:
  re-express the binding against a thin, text-oriented `NoteStore` (not the
  block-oriented `DocStore`). The engine stays CRDT-agnostic and testable via
  `MemNoteStore`; CodePair's CRDT logic (op translation, posRange conversions)
  moves into the frontend `YorkieNoteStore`. Side benefit: drops `lib0`/`lodash`.
- **Yorkie version skew (0.7.12 → 0.7.8).** Plan Task 2 Step 0 spikes the 0.7.8
  `Text` API (`edit`/`toString`/`indexRangeToPosRange`/`posRangeToIndexRange`).
  Record any deltas here.
- **Undo model.** CodePair disabled CodeMirror history and relied on Yorkie undo.
  P1 instead keeps CodeMirror local history and excludes remote transactions from
  it (`Transaction.addToHistory.of(false)`). Record if collaborative-undo
  expectations surface.

## Findings

- **Task 2 spike (Yorkie 0.7.8):** `Text.edit`, `Text.toString`,
  `Text.indexRangeToPosRange`, `Text.posRangeToIndexRange` all exist in 0.7.8 —
  the port's presence conversions are safe. BUT a **detached** `new Text()`
  (created outside `doc.update`) throws `ErrNotInitialized` when any method is
  called on it. Implication: `initialNotesRoot()` returning a bare `new Text()`
  is fine because `client.attach({ initialRoot })` seeds it inside the SDK
  (same as docs' `initialDocsRoot`), but tests must NOT call `.toString()`/
  `.edit()` on a detached Text. Task 8's test was corrected to assert
  `instanceof Text` instead; the real round-trip is covered by Task 9's test,
  which drives an attached `Document`.
- **Shell note:** this environment's `ls` wrapper can misreport directory
  contents as empty; use `/bin/ls` or `find`. (Also relevant to any agent
  verifying build output under `dist/`.)
- **Task 8 (frontend test discovery gap — plan error):** the plan placed
  frontend tests co-located in `src/` (`src/types/notes-document.test.ts`,
  `src/app/notes/yorkie-note-store.test.ts`), but `packages/frontend`'s Vitest
  `include` was `tests/**` ONLY — co-located `src/**` tests were never
  discovered. Resolution: broadened the glob to also include
  `src/**/*.test.{ts,tsx}`. This surfaced one previously-dormant co-located
  test (`src/app/slides/theme-fonts.test.ts`) that had been silently not
  running and failed on a missing `Fraunces` font in the Google Fonts seed;
  that was fixed by adding the entry. Net-positive (co-located tests now run,
  matching the engine packages; a dead test is now live + green), but it is a
  shared-config change bundled into Task 8. Future plans: either place
  frontend tests under `tests/` or plan the glob change as its own step.
- **Task 5 (CodeMirror plugin init timing):** a `ViewPlugin` does NOT get
  `update()` called on initial construction — only after the first transaction.
  So any plugin that renders decorations from external state (peer selections)
  must build its decorations in the CONSTRUCTOR too, not only in `update()`,
  or state present at mount stays invisible until the next edit. Task 5
  factored a shared `buildDecorations(state)` called from both. Keep this in
  mind for any future CM decoration plugins in this engine.

- **Frontend verification (Tasks 9-13):** `packages/frontend` has NO `typecheck` script. Its real gate = `pnpm --filter @wafflebase/frontend lint` (eslint --max-warnings 0) + `pnpm --filter @wafflebase/frontend test` + `pnpm --filter @wafflebase/frontend build` (vite). Do NOT judge by raw `tsc --noEmit -p tsconfig.app.json` — the repo has ~122 baseline tsc errors on that config; it is not the enforced gate.
- **verify:fast gap:** root `verify:fast` and `test` enumerate packages explicitly and did NOT include `@wafflebase/notes`. Wired in as Task 14 Step 0 so the engine suite runs in the pre-commit gate.

- **CRITICAL runtime bug (`{"context":null,"text":null}` on new note):** Yorkie
  CRDT values seeded via `client.attach({ initialRoot })` (or any `doc.update`
  under `@yorkie-js/react`) MUST be constructed from the CRDT class exported by
  **`@yorkie-js/react`**, NOT `@yorkie-js/sdk`. The react package bundles its own
  copy of the SDK, so `sdk.Text !== react.Text` (distinct class identities). The
  provider's `client.attach`/`buildCRDTElement` recognizes CRDT types via
  `instanceof` against react's classes; an sdk `Text`/`Tree` fails the check and
  is silently materialized as a plain `CRDTObject` built from the wrapper's own
  fields (`Text` → `{ context, text }`, both null), whose `toString()` is the
  literal `{"context":null,"text":null}`. `docs-view.tsx` already imports `Tree`
  from `@yorkie-js/react` for exactly this reason (its `ensureTree`); notes
  originally imported `Text` from `@yorkie-js/sdk` in `initialNotesRoot()` and
  hit the bug. Fix: import `Text` from `@yorkie-js/react` in `notes-document.ts`
  + add `ensureText()` repair in `notes-view.tsx` for already-broken persisted
  docs. Regression guard: `notes-document.test.ts` asserts `content instanceof`
  the **react** Text. Proven byte-exact via node repro. Applies to ANY future
  Yorkie CRDT type in the frontend.
