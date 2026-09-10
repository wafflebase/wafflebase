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

### Added during review (round 14)

- [x] `insertLink`'s **plain** multi-block arm batches too. The third of its
      three selection shapes — the one a ⌘K over a select-all reaches, since
      `linkRunCoveringRange` never matches across blocks — was the last
      unbatched `applyInlineStyle` in the file, so 60 linked paragraphs left
      the first ten linked past any Cmd+Z.
- [x] `docs-view-readonly.test.tsx` — the docs twin of the notes/slides
      read-only remount tests: the rebuild on a role downgrade, and
      `YorkieDocStore.dispose()` releasing the discarded subscription.
- [x] `layout-keep-dirty.test.ts` — `recomputeLayout({ keepDirty })` keeps the
      per-keystroke paint incremental. Cold measure cache, or a full second
      pass rides the memo and the two paths are indistinguishable.
- [x] The undo-floor identity-stability test now discriminates: it drives the
      stack to the cap with the floor still on it, which is the one state
      where the identity path's "floor is gone" latch would undo past the
      initial load.
- [x] `applyStyleToSelection`'s doc comment no longer claims every caller
      snapshots. `toggleStyle` does not, and correctly: a style toggle moves
      no caret, and `consumePendingCursor()` means an unstaged write records
      no presence rather than a stale one. *(Corrected again in round 15 —
      "records no presence" is only the usual case, see below.)*

### Added during review (round 15)

- [x] `isShareLinkResolveFatal` / `shouldRetryShareLinkResolve` — the two
      expressions the `useState`/`useEffect` → 60-second-refetch rewrite of
      `SharedDocumentByToken` rests on, split out of the component into
      `api/share-links.ts` next to `isRevokedShareLinkError` and covered in
      `share-links.test.ts`. Only the predicate was tested before; nothing
      exercised the *composition*, so collapsing `fatal` to `Boolean(error)`
      or dropping its `!resolved` conjunct would have gone unnoticed.
      Extracted rather than tested through a mount because the non-fatal case
      is the one that matters and it renders `SharedDocumentInner` — the whole
      editor and every provider under it. Both mutations were run and both go
      red (`!resolved` dropped → "closes a link that never resolved"; whole
      conjunct → "keeps a live session through a refetch failure").
- [x] `pastePlainTextFromClipboard`'s `readOnly` re-check keeps the guard but
      loses the claim: the field is assigned once in the constructor
      (`text-editor.ts:719`) and has no setter, so it cannot differ from the
      value the keydown gate read. A permission flip rebuilds the editor
      (`docs-view.tsx`, effect keyed on `[didMount, doc, readOnly]`), which
      makes `this.disposed` the check that actually catches a mid-prompt
      downgrade.
- [x] `applyStyleToSelection`'s "records no presence at all" is now stated
      with its condition. `consumePendingCursor()` clears on every *write*, so
      an unstaged toggle that follows a write records nothing — but a
      `saveSnapshot()` whose path then returned without writing
      (`handleBackspace` at the first block of a cell, a sub-pixel border
      drag) leaves a position staged for the next write to consume as its
      reverse caret. Pre-existing, and a property of the staging protocol
      rather than of style.
- [x] `insertLink`'s snapshot-outside-the-batch comment points at the right
      place (`TextEditor.withUndoUnit` / `MemDocStore.batch()`'s adoption)
      and says why it is free here, instead of at the caret branch, which
      documents a *presence* write for an unrelated reason.
- [x] The `doc` import branch in `apply-imported-content.ts` disposes its
      `YorkieDocStore`, matching the `board` branch. Not a leak — the store
      and the document are both function-scoped and `onRemoteChange` is never
      set — so this is symmetry, so that `dispose()` reads as unconditional
      at every `new YorkieDocStore` in the repo.

## Follow-ups (found in review, deliberately not in this PR)

Each is real and each is new scope; none is a regression from this branch.

- `applySpellSuggestion` (`editor.ts`) is two undo units.
- `TextBoxEditorAPI.applyBlockStyle` (`text-box-editor.ts:1085`) is a **fourth**
  unbatched `forEachBlockInSelection` site — real, and it goes to #1048 with
  the other three rather than widening this PR again.
- `mergeTableCells` / `splitTableCell` write one op per cell, unbatched.
- The three sibling stores (`yorkie-slides-store.ts` and friends) still key
  their undo floor on a depth, so they carry the pre-#1045 bug this branch
  fixed for docs.
- `MemSlidesStore.batch()` does not match `MemDocStore.batch()` (no
  `snapshot()` seam, so no deferral and no adoption).
- The stale-`blockId` hazard in the cell-range writers.
- Unifying the three copies of indent/outdent/toggleList — #1048, see below.

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
