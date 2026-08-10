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

## Out of scope

- The `Cmd/Ctrl+B` keyboard path (`TextEditor.toggleStyle` in
  `packages/docs/src/view/text-editor.ts`) shares the mechanism — it reads
  `getStyleAtCursor()`. Making it range-aware needs a range walk inside the
  `TextEditor` class (the summary lives in the `editor.ts` API factory), which
  is a larger change than this issue asks for. Recorded as a known limitation.
- The `getSelectionStyle()` `<=` boundary for a collapsed caret — the issue
  explicitly defers this ("worth checking separately"); at a run boundary
  returning the preceding run's style matches what typing there inherits.
- The slides mobile toolbar (`slides/toolbar/mobile-toolbar.tsx`) uses the same
  pattern; not a docs surface, left alone.
