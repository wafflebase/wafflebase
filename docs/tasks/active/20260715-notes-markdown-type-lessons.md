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

_(add as you go)_
