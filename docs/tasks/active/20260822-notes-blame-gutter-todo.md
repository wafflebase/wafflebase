# Notes: per-line author gutter (issue #814)

Show, to the left of the line numbers, who last edited each line of a
markdown note — like `git blame`. Off by default; opt in from the view
menu. Nothing changes for someone who never turns it on.

## Acceptance criteria (from the issue)

- [ ] A blame gutter sits **left of the line numbers**; each line shows the
      author of its most recent edit.
- [ ] Consecutive lines by the same author collapse into one label.
- [ ] **Off by default**, toggled from the view menu. With it off the note
      renders exactly as today (same layout, same line width).
- [ ] Notes written before this ships have no per-line authorship: those
      lines show **blank**, not a wrong name. No migration, no backfill —
      attribution accrues from the first edit after the feature lands.
- [ ] Anonymous editing keeps working; anonymous lines fall back to
      **"Anonymous"**.

## Design

Authorship rides on the existing `root.content` Yorkie `Text` as **per-run
attributes** — `edit(from, to, insert, { a: <name>, t: <epoch ms> })`. No new
root field, so the CodePair-compatible schema (`{ content: Text }`) is
untouched and a reader that ignores attributes still sees the same string.
Text that predates the feature simply carries no attributes → blank gutter.

- `packages/notes/src/store/store.ts` — `NoteAuthorSpan` +
  `NoteStore.getAuthorSpans()`.
- `packages/frontend/src/app/notes/yorkie-note-store.ts` — write the
  attributes on insert (author read from the local presence `name`, which is
  already `"Anonymous"` for anonymous share-link editors); read them back
  through `content.values()`.
- `packages/notes/src/store/memory.ts` — per-character authorship so the
  engine is testable without Yorkie (`setLocalAuthor`).
- `packages/notes/src/view/blame-gutter.ts` — CodeMirror `gutter()` placed
  before `basicSetup` (facet order = gutter order → left of line numbers) +
  a view plugin that caches per-line labels.
- Engine API: `NoteEditorOptions.showAuthors`, `setShowAuthors()`,
  `getShowAuthors()`; a `Compartment` so "off" adds no extension at all.
- Frontend: `notes-settings.ts` pref, view dropdown checkbox item in
  `notes-toolbar.tsx`, wiring in `notes-detail.tsx` / `notes-view.tsx`.

Per-line author = the author of the highest-`t` run overlapping the line
(unattributed runs sort as `t = 0`), which is literally "the author of the
line's most recent edit".

## Steps

- [ ] Store: `NoteAuthorSpan` + `getAuthorSpans()` (interface, memory, Yorkie).
- [ ] Engine: blame gutter extension + compartment + editor API.
- [ ] Frontend: view-menu toggle, persisted preference, prop wiring.
- [ ] Tests: memory store spans, gutter labels/collapsing/blank/Anonymous.
- [ ] Design doc subsection in `docs/design/notes/notes.md`.
