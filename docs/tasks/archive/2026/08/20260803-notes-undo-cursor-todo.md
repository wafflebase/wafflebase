# Notes undo/redo caret preservation — TODO

## Problem

Running undo/redo in the Notes editor does not preserve the caret/selection.
The reverted text arrives through `NoteStore.subscribeRemote` → `note-sync.ts`
`applyRemote`, which dispatches a CodeMirror transaction with **no `selection`**.
The caret is therefore left to CodeMirror's default change-mapping (and drops to
0 on the full-`replace` path).

Docs solved the identical bug (`docs/tasks/archive/2026/07/20260722-docs-undo-selection-todo.md`)
by recording the caret/selection into Yorkie presence with `{ addToHistory: true }`
so Yorkie reverses it on undo, then explicitly re-applying it in the view after
`undo()/redo()`. This task ports that pattern to Notes.

## Approach (mirror the docs pattern, adapted to CodeMirror flat indices)

1. **Record post-edit selection into the undo unit.** In the same `doc.update`
   that commits a batch of edits, write the selection presence with
   `{ addToHistory: true }`. Yorkie stores the reverse (pre-edit selection) →
   undo restores it; redo re-applies the post-edit selection.
2. **Read the restored selection after undo/redo** and return it from
   `undo()/redo()`.
3. **Re-apply it in the view** (`runHistory` + vim route) via a selection-only
   `view.dispatch`, after the reverted text has already landed synchronously
   through `subscribeRemote`.

Selection is stored as the CRDT-stable `TextPosStructRange` posRange (survives a
peer's concurrent edit), converted to CodeMirror indices on read — same
robustness reason docs used posRange anchors.

## Changes

- [x] `packages/notes/src/store/store.ts`
  - [x] Add `NoteSelection = { anchor: number; head: number }`.
  - [x] `undo(): NoteSelection | null` / `redo(): NoteSelection | null` (was `void`).
  - [x] Add `recordSelectionForHistory(anchor, head): void` — record the
        current batch's post-edit selection into its undo unit.
- [x] `packages/frontend/src/app/notes/yorkie-note-store.ts`
  - [x] `recordSelectionForHistory`: inside an active batch, `activePresence.set`
        the selection posRange with `{ addToHistory: true }`.
  - [x] `undo()/redo()`: after `doc.history.[undo|redo]()`, read restored
        `selection` presence (posRange → index) and return it. Offline/test
        fallback via `getPresenceForTest` (mirror docs).
- [x] `packages/notes/src/store/memory.ts`
  - [x] Track `curSel`; store before-selection per undo unit; return the
        restored selection from `undo()/redo()`.
- [x] `packages/notes/src/view/note-sync.ts`
  - [x] After a batch that actually edited, call
        `store.recordSelectionForHistory(update.state.selection.main.anchor, .head)`.
- [x] `packages/notes/src/view/editor.ts`
  - [x] `runHistory`: apply the returned selection via `view.dispatch({ selection })`.
  - [x] vim route (`routeVimHistoryToStore`): apply the returned selection too.

## Tests (TDD — write first, watch fail)

- [x] `memory.test.ts`: undo/redo returns the pre/post-edit selection.
- [x] `yorkie-note-store.test.ts`: a batch that records a selection, then
      `undo()` returns the pre-edit caret; `redo()` returns the post-edit caret;
      an empty/remote-only batch records no selection unit.
- [x] `notes-undo-integration.test.ts` (or note-sync): caret restored in the
      mounted view after undo.

## Invariants to keep green

- Empty / remote-only batches record no undo unit (existing tests #4, #5).
- The selection-only restore dispatch must not echo as a local edit
  (docChanged=false → `note-sync` skips it) nor push a new Yorkie change.

## Verify

- [x] `pnpm verify:fast` (exit 0, 0 TS errors)
- [x] Self code review (workflow /code-review high) — findings below
- Not verified: manual smoke in `pnpm dev` (type, move caret, Cmd+Z /
  Cmd+Shift+Z). Code and unit tests are green; no human run was performed.

## Review findings addressed

- **[CONFIRMED] Undo-vs-live-publisher race** — `undo()` read presence AFTER
  the remote-selection plugin republished the live caret during the same undo
  dispatch, returning the wrong value. Fixed by capturing the reversed selection
  DURING the `undoredo` event via a constructor-registered subscriber that runs
  before the view's, into `pendingHistorySelection`. Regression test added.
- **[CONFIRMED] MemNoteStore redo drift** — redo restore point was snapshotted
  from the mutable `currentSelection` at `undo()` time, so a caret move between
  edit and undo corrupted the redo caret. Fixed by pinning before/after states
  per undo unit at commit. Regression test added.
- **[PLAUSIBLE] First-edit reverse empty** — the pre-edit caret was only in
  presence if the focus-gated live publisher had run. Fixed by publishing the
  pre-edit selection (`update.startState`) in `note-sync` before the batch —
  the docs `setCursorForHistory` equivalent, not focus-gated.
- **[cleanup] Duplication** — extracted `buildSelectionPresence` (shared by
  `recordSelectionForHistory` + `setLocalSelection`).
- **[known limitation]** `applyRestoredSelection` scrolls the caret into view on
  undo/redo (matches CodeMirror native-undo behavior; intentional).
