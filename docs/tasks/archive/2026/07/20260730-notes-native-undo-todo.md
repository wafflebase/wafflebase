# Notes native undo — migrate to Yorkie `doc.history` (issue #604)

PR: (to be filled after opening)

## Goal

Move WaffleNotes undo/redo off CodeMirror's local history onto
Yorkie-native undo (`doc.history`), so undo carries CRDT semantics and
preserves a peer's concurrent edits instead of last-write-wins-ing over
them. Reuses the pattern already shipped in Slides
(`docs/design/slides/slides-native-undo.md`) and Docs
(`packages/frontend/src/app/docs/yorkie-doc-store.ts`).

## Prerequisite spike (done — result recorded here)

Verified against the pinned `@yorkie-js/sdk` 0.7.13 that character-level
`Text.edit()` **is** reversible through `doc.history`:

- Two `content.edit()` calls inside ONE `doc.update()` push exactly one
  undo-stack entry; `history.undo()` reverts both, `redo()` re-applies.
- The undo emits a `local-change` event with `source === 'undoredo'`
  carrying `edit` ops on `$.content` with correct `from`/`to`/`content`
  (already reversed in apply order), i.e. the dormant `isUndoRedo` path
  in `yorkie-note-store.ts` receives exactly what it needs.
- A `doc.update()` whose body mutates nothing pushes **no** undo entry,
  so an empty batch is free.

(`Tree.editByPath` merge non-reversibility, called out in the issue,
does not apply — notes store markdown in a single `Text`.)

## Approach

**Store layer (`packages/notes/src/store/store.ts`)** — extend
`NoteStore` with `batch(fn)`, `undo()`, `redo()`, `canUndo()`,
`canRedo()`. Undo becomes store-owned (like `DocStore`/`SlidesStore`)
rather than view-owned.

**`YorkieNoteStore`** — ambient-root + `withUpdate()`: a top-level
`batch()` opens ONE `doc.update()` and every `editText()` runs against
that ambient root, so one CodeMirror transaction group = one Yorkie
change = one undo unit. `setLocalSelection` folds into the batch's
ambient presence proxy when a batch is open. `undo()/redo()` delegate to
`doc.history`, gated by an undo floor captured at construction (after
`ensureText()` seeding) so a user cannot undo the seed away.

**`MemNoteStore`** — snapshot-based local history so the engine still
has working undo without a CRDT (tests / non-collaborative use). Undo
emits a `replace` remote change so the view reflects it, mirroring how
the Yorkie store's undo comes back through `subscribeRemote`.

**`note-sync.ts`** — wrap the per-`ViewUpdate` `editText` loop in
`store.batch()`.

**`editor.ts`** — `basicSetup({ history: false, historyKeymap: false })`;
bind `Mod-z` / `Mod-Shift-z` / `Mod-y` to the store (skipped in
read-only); `NoteEditorAPI.undo/redo/canUndo/canRedo` delegate to the
store. Vim's `u` / `<C-r>` go through `CodeMirror.commands.undo/redo`,
which the vim adapter looks up at call time — override them once to
route to the note store resolved from the view's `noteStoreFacet`, else
vim undo would silently no-op with CM history disabled.

## Tasks

- [x] `NoteStore`: `batch` / `undo` / `redo` / `canUndo` / `canRedo`
- [x] `MemNoteStore`: snapshot history + `replace` emission on undo/redo
- [x] `YorkieNoteStore`: ambient root, `withUpdate`, batch, undo floor,
      `doc.history` delegation
- [x] `note-sync.ts`: wrap local edits in `store.batch()`
- [x] `editor.ts`: disable CM history, history keymap → store, API
      delegation, vim command routing
- [x] Tests: batch grouping = 1 undo unit, undo floor, peer-edit
      preservation (churn regression), no-echo on undo, MemNoteStore
      history, engine-level keybinding
- [x] `docs/design/notes/notes.md`: Yorkie-native undo section

## Out of scope

- Time-based keystroke coalescing (Yorkie's undo unit is the change;
  Docs and Slides behave the same way).
- `:undo` / `:redo` ex-commands in vim (the vim package snapshots those
  handlers at module load, so they cannot be re-routed).
