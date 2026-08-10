# Docs B/I/U/S toggles: decide from the range, not the caret

Issue: #715

## Problem

The docs toolbar's Bold / Italic / Underline / Strikethrough buttons decide
whether to add or remove a style with

```ts
const current = editor.getSelectionStyle();
editor.applyStyle({ bold: !current.bold });
```

`getSelectionStyle()` samples a **single caret position**. With a backward
(right-to-left) selection the caret sits at the range's *start*, and the
`offset <= inlineEnd` match resolves to the run that *ends* there — i.e. the
run **preceding** the selection. The toggle then inverts the wrong value.

Visible consequence (issue repro): bold `abcdef`, backward-select `cd`, click
Bold (bold is removed — correct), click Bold again — nothing happens, ever.
Selected forward the same two characters toggle correctly.

Affects all four toggles in the shared `TextFormatGroup` and the B/I/U trio in
the docs header/footer slim toolbar.

## Approach

`getRangeStyleSummary()` already exists on both `EditorAPI` (docs) and
`TextBoxEditorAPI` (slides text boxes), is range-aware, and reports
`bold: false` for the failing case. For a collapsed caret both editors return
exactly what `getSelectionStyle()` returns (same caret walk, same named-style
defaults, same pending merge), so switching the toggles to the summary is a
no-op for carets and a fix for ranges.

Rule: `'mixed'` counts as "not fully applied" → the click **applies** the
style to the whole range (Google Docs behaviour).

## Tasks

- [x] Add a shared `isStyleOn(value)` helper (`true` only when the summary is
      literally `true`) and export it from `components/text-formatting`.
- [x] `TextFormatGroup`: route the four toggles' *action* and their `pressed`
      state through `getRangeStyleSummary()`.
- [x] `docs-formatting-toolbar.tsx` header/footer slim toolbar: same for B/I/U.
- [x] Regression tests: backward-selection case (caret style disagrees with
      range summary) and `'mixed'` → apply, for all four toggles.
- [x] Update the `toolbar-focus` test's editor mock with the summary method.
- [x] `TextEditor.toggleStyle`: make the `Cmd/Ctrl+B` / `I` / `U` /
      `Shift+X` keyboard path decide from the range too, via a
      `isStyleOnInSelection()` walk inside the `TextEditor` class (mirrors
      `Doc.applyInlineStyle`'s range walk so the read covers exactly the runs
      the write touches). Without it the keyboard and the fixed toolbar
      disagreed on the same selection.
- [x] Slides mobile toolbar (`slides/toolbar/mobile-toolbar.tsx`): same swap
      for its own B/I/U trio, which sits in the same bar as a
      `TextFormatGroup` and would otherwise contradict it.
- [x] Engine-level regression tests for the premise itself
      (`packages/docs/test/view/backward-selection-toggle.test.ts`): the real
      editor's `getSelectionStyle()` vs `getRangeStyleSummary()` disagreement
      on a backward selection, plus the Cmd+B path end-to-end.
- [x] Header/footer slim toolbar regression tests
      (`packages/frontend/tests/app/docs/docs-formatting-toolbar-header-footer.test.tsx`).

## Out of scope

- The `getSelectionStyle()` `<=` boundary for a collapsed caret — the issue
  explicitly defers this ("worth checking separately"); at a run boundary
  returning the preceding run's style matches what typing there inherits.
- The header/footer slim toggles' `pressed` state: those `Toggle`s were
  already uncontrolled before this change (no `pressed` prop at all), so
  wiring them is a separate fix.
