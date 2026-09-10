# Docs: select-all then type is one undo unit (#1045)

## Problem

In a docs document with ~100 paragraphs, `Cmd/Ctrl+A` then typing a character
replaces the document correctly, but no number of `Cmd+Z` presses brings it
back. The action costs ~102 undo units (one store write per deleted block)
while Yorkie's undo stack is capped at 50 (`MaxUndoRedoStackDepth`), so the
earliest entries — the ones holding the tail of the document, because
`deleteSelection()` deletes backwards — are `shift()`ed off permanently.

Root cause: `TextEditor.deleteSelection()` makes one store write per block,
and outside a `DocStore.batch()` every write is its own `doc.update()`, which
is one Yorkie undo unit. The `DocStore.batch()` seam already exists (named
styles, link runs, `insertBlocksAfter`); the selection-replacing edit paths
never used it.

Secondary: `YorkieDocStore.canUndo()` compares the undo stack's *length*
against `undoFloor`. Once the stack drops entries from the bottom, that length
no longer means what the floor was recorded against, so undo stops early.

## Goal

One user action = one undo unit for every selection-replacing edit, so the
50-entry cap is never reached by a single keystroke.

## Plan

- [x] `TextEditor.withUndoUnit(fn)` — runs `fn` inside `Doc.batch()` and holds
      `requestRender()` until the outermost unit commits, so layout and paint
      stay outside the batch (the rule `withNamedStyleChange` documents).
- [x] `deleteSelection()` wraps its body in `withUndoUnit`, so *every* call
      site (backspace, delete, word/line delete) is at most one unit.
- [x] Composite actions wrap delete + the writes that follow in one unit:
      typing (`handleInput`), programmatic `insertText`, paste
      (`applyPastePlan`, `pastePlainTextFromClipboard`), `handleEnter`,
      `handlePageBreak`, the Hangul commit path.
- [x] `saveSnapshot()` stays **outside** the batch — it flushes the pre-edit
      caret/selection into presence, and `skipNonHistoryPresence()` drops that
      write inside an open batch.
- [x] `YorkieDocStore` undo floor: mark the floor by the *identity* of the
      stack's top entry at load time instead of a depth, so entries dropped
      from the bottom cannot make `canUndo()` lie.
- [x] Test: `packages/frontend/tests/app/docs/editor-undo-selection.test.ts` —
      select-all + type over a 100-paragraph document is one undo unit and one
      `Cmd+Z` restores every block.
- [x] Update `docs/design/docs/docs-collaboration.md` (Undo/Redo section).

### Added during review (round 13)

The keyboard fix left the toolbar's own paths unbatched, which the panel read
— correctly — as shipping the same data loss behind a different control.
Scope was widened to close the class rather than defer it to #1048:

- [x] `EditorAPI` block mutators batch their `forEachBlockInSelection` loops:
      `applyBlockStyle`, `toggleList`, `indent`, `outdent`.
- [x] The two cell-rectangle writers batch too: `applyTableCellStyle` (one
      write per cell) and `insertLink`'s cell-range arm.
- [x] `FindReplaceState.replaceAll()` / `replaceActive()` — two writes per
      match, so Replace All exceeded the cap at 26 matches.
- [x] `text-box-editor.ts`'s copy of `indent` / `outdent` / `toggleList`, so
      all three copies of that logic answer the same. Granularity only there:
      `MemDocStore`'s stack is uncapped.
- [x] `MemDocStore.snapshot()` defers its checkpoint to the first write, so
      an action that snapshots and writes nothing costs no undo unit (it left
      a dead Cmd+Z, then a dead Cmd+Shift+Z on top of the preserved redo
      stack). Also replaces `batch()`'s stringify-and-compare adoption
      heuristic with reading the deferred field.
- [x] `YorkieNoteStore.dispose()`, called by the notes view's cleanup — the
      `readOnly` dep made that effect re-run with no way to release the
      store's constructor subscription.
- [x] `isRevokedShareLinkError` enumerates the two statuses the resolve
      handler returns (404 / 410) instead of "any 4xx bar 408 and 429".
- [x] `docs/design/sharing.md` records the mid-session downgrade + handle
      revocation model; `requestLayoutRefresh` becomes
      `recomputeLayout({ keepDirty: true })`.

## Non-goals

- Changing Yorkie's 50-entry cap.
- IME composition undo granularity (`compositionstart`'s delete stays its own
  unit by design — see docs-intent-preserving-edits.md).
- Collapsing multi-keystroke typing runs into one undo unit.
- Unifying the three copies of `indent` / `outdent` / `toggleList`. They are
  each batched now, but the logic is still written three times; routing the
  `EditorAPI` copies through `TextEditor`'s is not behaviour-preserving
  (`TextEditor.toggleList()` acts on the caret's block, the `EditorAPI` one on
  the whole selection, and `textEditor` is absent on a read-only mount).
  Stays with #1048.
