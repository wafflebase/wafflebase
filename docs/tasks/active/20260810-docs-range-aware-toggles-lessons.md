# Lessons — docs range-aware B/I/U/S toggles (#715)

- **A caret is not a selection.** `getSelectionStyle()` reads one position, so
  every "read current style, invert it" toggle is direction-dependent: a
  backward selection parks the caret at the range *start* and the
  `offset <= inlineEnd` match returns the run *before* the selection. Any new
  selection-scoped decision should read `getRangeStyleSummary()` instead.

- **The collapsed-caret paths were already identical.** Both `EditorAPI`
  (`packages/docs/src/view/editor.ts`) and `TextBoxEditorAPI`
  (`packages/docs/src/view/text-box-editor.ts`) implement
  `getRangeStyleSummary()`'s no-selection branch as the same caret walk their
  `getSelectionStyle()` uses — same named-style defaults, same pending-style
  merge. That parity is what made the swap safe rather than a behaviour change
  for carets; it is worth preserving when either function is touched.

- **Button state and button action must read the same source.** Fixing only
  the click handler would have left Bold rendering as pressed (caret says
  bold) while clicking it *adds* bold (range says not bold). `pressed` moved to
  the summary too, with `'mixed'` rendering unpressed — consistent with
  `'mixed'` meaning "click applies".

- **Shared components are shared bugs.** `TextFormatGroup` is mounted by both
  the docs toolbar and the slides text-box toolbar, so one fix covered both
  surfaces; the docs header/footer toolbar hand-rolls its own B/I/U trio and
  had to be fixed separately. Grepping for the *shape* (`bold: !`) rather than
  the component name is what found all the call sites.
