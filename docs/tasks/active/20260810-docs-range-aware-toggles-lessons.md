# Lessons — docs range-aware B/I/U/S toggles (#715)

- **A caret is not a selection.** `getSelectionStyle()` reads one position, so
  every "read current style, invert it" toggle is direction-dependent: a
  backward selection parks the caret at the range *start* and the
  `offset <= inlineEnd` match returns the run *before* the selection. Any new
  selection-scoped decision should read `getRangeStyleSummary()` instead.

- **The collapsed-caret paths looked identical and were not.** Both `EditorAPI`
  (`packages/docs/src/view/editor.ts`) and `TextBoxEditorAPI`
  (`packages/docs/src/view/text-box-editor.ts`) implement
  `getRangeStyleSummary()`'s no-selection branch as the same caret walk their
  `getSelectionStyle()` uses, with the same pending-style merge — so the swap
  was assumed to be a no-op for carets. Review found one difference that
  mattered: only the docs editor layered the block's *named-style* inline
  defaults. In a text box (and so in every slides shape / text-box / table-cell
  editor built on the same factory) a caret in a Heading 6, whose built-in
  style supplies `italic`, read as "not italic" — the toolbar's Italic click
  applied italic for no visual change while the keyboard removed it. Exactly
  the #715 shape, one caret apart. "The two implementations look the same" is a
  hypothesis; diffing them line by line is the check.

- **Button state and button action must read the same source.** Fixing only
  the click handler would have left Bold rendering as pressed (caret says
  bold) while clicking it *adds* bold (range says not bold). `pressed` moved to
  the summary too, with `'mixed'` rendering unpressed — consistent with
  `'mixed'` meaning "click applies".

- **Fix every entry point to the same mutation, not just the loudest one.**
  The toolbar was the reported surface, but `Cmd/Ctrl+B` (`TextEditor.toggle
  Style`) and the slides mobile bar invert the same value from the same caret
  read. Fixing only the toolbar would have left the *same document* behaving
  two different ways depending on whether the user clicked or pressed a key —
  worse than the original bug, which was at least consistent.

- **Shared components are shared bugs.** `TextFormatGroup` is mounted by both
  the docs toolbar and the slides text-box toolbar, so one fix covered both
  surfaces; the docs header/footer toolbar hand-rolls its own B/I/U trio and
  had to be fixed separately. Grepping for the *shape* (`bold: !`) rather than
  the component name is what found all the call sites.

- **"Mirrors X" in a header comment is a promise no one can keep.** The first
  attempt at read/write agreement was a second walk in `view/range-runs.ts`
  that hand-copied `Doc.applyInlineStyle`'s four-branch dispatch, with a
  comment saying so. That is the same drift #715 was about, just younger — and
  it drifted immediately: the new copy guarded a negative `getBlockIndex`
  result and the write it "mirrored" did not, so a selection with an endpoint
  inside a *nested* table read as empty and then crashed the write on
  `contextBlocks[-1].type`. The fix is not to sync the copies but to delete
  one: `visitRangeSlices` (`packages/docs/src/model/range-slices.ts`) is now
  the single traversal, with the write as one visitor over it and the reads as
  another. Agreement becomes structural instead of maintained.

- **Model traversals belong in `model/`.** The walk touched only `Doc` state
  (`findBlock`, `blockParentMap`, `getContextBlocks`, `resolveStyleInline`) and
  no layout, but living in `view/` it could not be the thing `Doc` itself calls
  — which is what forced the copy. Where a helper sits decides who is allowed
  to reuse it.

- **A gap must be symmetric, not silent.** Nested table content is still
  neither read nor written by a range toggle. Keeping that symmetric is
  deliberate: a read that reports runs the write cannot reach is precisely the
  "style can be added but never removed" trap. Both halves now come from one
  traversal, so closing the gap closes it on both sides at once — recorded in
  `docs/design/docs/tables/docs-nested-tables.md` rather than left implicit in
  the code.
