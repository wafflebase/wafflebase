# Font size ± steps each run relative to its own size (issue #343)

## Context

Issue #343: increasing font size on a mixed-size selection collapsed the
whole selection to `FONT_SIZE_MIN`. Root cause was two-layered:

1. `font-size-picker.tsx`'s `step()` computed `base = value ?? Number(draft)`;
   for a mixed selection `value` is `undefined` and `draft` is `""`, so
   `Number("") = 0` and `clamp(0 + 1)` yielded `FONT_SIZE_MIN`.
2. More fundamentally, `onChange: (size: number)` carries one absolute size
   for the whole selection, so per-run relative stepping (Google Docs: an
   11pt run becomes 12pt, a 36pt run becomes 37pt, in the same click) cannot
   be expressed by the signature.

Layer 1 was already fixed as a side effect of PR #358 (2026-06-12, a
slides-focused font-size fix that touches the same shared component) — `+`
on a mixed selection is a no-op today, not a collapse to minimum. That PR
did not close #343 or update `docs/design/docs/docs-font-controls.md`, whose
Risks table still documents the old "mixed selections apply the new value
uniformly" intent — which no longer matches shipped behavior (no-op) either.

Layer 2 — real per-run relative stepping — is still missing. This task
implements it and corrects the stale design-doc row.

## Plan

1. **Design note** — update `docs/design/docs/docs-font-controls.md`:
   add a subsection for relative ± stepping, revise the stale "mixed
   selections apply uniformly" Risks row.
2. **`packages/docs/src/view/editor.ts`** — add `stepSelectionFontSize(delta,
   clamp)` to `EditorAPI`: walks each inline run intersecting the
   selection (regular range, cross-block range, and table cell-range),
   resolves each run's effective size (style defaults + explicit style,
   matching `getRangeStyleSummary`'s resolution), and applies
   `clamp(effectiveSize + delta)` to just that run's sub-range via
   `store.applyStyle`. Collapsed caret keeps the existing single-value
   step behavior (there is only one "current" value).
3. **`packages/slides/src/view/editor/text-box-editor.ts`** — delegate a
   `stepSelectionFontSize` wrapper to the underlying docs `EditorAPI`
   (mirrors the existing `applyStyle`/`getRangeStyleSummary` wrappers), so
   Slides text-box editing gets the same behavior for free.
4. **`font-size-picker.tsx`** — add an optional `onStepMixed?: (delta:
   number) => void` prop; `step()` calls it (instead of no-op) when
   `value === undefined && draft === ""`.
5. **Wire callers**: `docs-formatting-toolbar.tsx`,
   `slides/toolbar/text-edit-section.tsx`,
   `slides/toolbar/mobile-toolbar.tsx` — pass
   `onStepMixed={(delta) => editor.stepSelectionFontSize(delta, clampFontSize)}`
   using the existing `FONT_SIZE_MIN`/`FONT_SIZE_MAX` from `font-catalog.ts`.
6. **Tests**: `packages/docs` editor test for `stepSelectionFontSize`
   (single-block mixed run, cross-block, table cell-range, clamp at
   min/max, collapsed caret unchanged); `font-size-picker.test.ts` for
   `onStepMixed` firing with the right delta instead of no-op.
7. `pnpm verify:fast`, self-review, comment + reference issue #343 in the
   PR (do not auto-close — leave that to review).

## Non-goals

- Typed-value / Enter / preset-pick commits on a mixed selection: unchanged
  (still writes one absolute value to the whole selection — matches Google
  Docs' own behavior for direct value entry, only the ± spinner is
  per-run-relative).
- Slides own theme-token `ThemedFontPicker` — untouched, this only affects
  the shared `FontSizePicker` used by the raw-family/size controls.
