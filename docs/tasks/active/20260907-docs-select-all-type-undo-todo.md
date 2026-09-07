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

- [ ] `TextEditor.withUndoUnit(fn)` — runs `fn` inside `Doc.batch()` and holds
      `requestRender()` until the outermost unit commits, so layout and paint
      stay outside the batch (the rule `withNamedStyleChange` documents).
- [ ] `deleteSelection()` wraps its body in `withUndoUnit`, so *every* call
      site (backspace, delete, word/line delete) is at most one unit.
- [ ] Composite actions wrap delete + the writes that follow in one unit:
      typing (`handleInput`), programmatic `insertText`, paste
      (`applyPastePlan`, `pastePlainTextFromClipboard`), `handleEnter`,
      `handlePageBreak`, the Hangul commit path.
- [ ] `saveSnapshot()` stays **outside** the batch — it flushes the pre-edit
      caret/selection into presence, and `skipNonHistoryPresence()` drops that
      write inside an open batch.
- [ ] `YorkieDocStore` undo floor: mark the floor by the *identity* of the
      stack's top entry at load time instead of a depth, so entries dropped
      from the bottom cannot make `canUndo()` lie.
- [ ] Test: `packages/frontend/tests/app/docs/editor-undo-selection.test.ts` —
      select-all + type over a 100-paragraph document is one undo unit and one
      `Cmd+Z` restores every block.
- [ ] Update `docs/design/docs/docs-collaboration.md` (Undo/Redo section).

## Non-goals

- Changing Yorkie's 50-entry cap.
- IME composition undo granularity (`compositionstart`'s delete stays its own
  unit by design — see docs-intent-preserving-edits.md).
- Collapsing multi-keystroke typing runs into one undo unit.
