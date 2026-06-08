# Docs: merge pending inline style into `getRangeStyleSummary` for collapsed caret

## Problem

In the docs editor, pressing the font size **+/−** buttons (or picking a
font family) with a collapsed caret produces no visible response after
the first click. The toolbar pickers freeze on the old value.

Root cause: `getRangeStyleSummary()` in `packages/docs/src/view/editor.ts`
returns `styleAtCaret()` directly in the collapsed-caret branch — it does
not merge in the pending inline style that `applyStyleImpl` just stored.
The pending mechanism (`docs-pending-inline-style.md`) was added with
`getSelectionStyle()` as the only toolbar read path (B/I/U buttons), but
the font family / size pickers in
`packages/frontend/src/app/docs/docs-formatting-toolbar.tsx` are driven
by `getRangeStyleSummary()`.

Effect — every consumer of `getRangeStyleSummary` collapsed-caret values:

- Desktop FontSizePicker `+` / `−` and numeric input
- Desktop FontFamilyPicker dropdown
- Header / footer slim toolbar (same pickers)
- Mobile overflow menu (same pickers)

After click #1 the local picker draft state updates, but click #2 reads
the same pre-pending caret value and computes the same `next`, so nothing
changes.

## Plan

- [x] Add a failing test in
  `packages/docs/test/view/editor-range-style-summary.test.ts` that:
  - Sets a collapsed caret
  - Calls `editor.applyStyle({ fontSize: 14 })`
  - Asserts `editor.getRangeStyleSummary().fontSize === 14`
  - Plus a fontFamily case for symmetry
- [x] Verify the test fails on `main`
- [x] In `packages/docs/src/view/editor.ts`, in `getRangeStyleSummary`'s
  collapsed-caret branch, merge `pending.get()` over `styleAtCaret()`,
  mirroring the existing logic in `getSelectionStyle()`
- [x] Verify the test passes
- [x] `pnpm verify:fast`
- [ ] Manual smoke (deferred — covered by unit tests at the API
  layer; user can verify in dev): `pnpm dev`, empty doc, click font
  size `+` twice → picker shows 12 then 13; pick a font from the
  family dropdown → label reflects the picked family
- [x] Capture lessons in matching `-lessons.md`
- [x] `pnpm tasks:archive && pnpm tasks:index`

## Notes

- Pure view-local; no DocStore, Yorkie, or model changes.
- Fix is symmetric across **all** `KEYS` in `getRangeStyleSummary` —
  color, backgroundColor, super/subscript, etc. all benefit, not just
  font size / family.
- Design doc `docs/design/docs/docs-pending-inline-style.md` is still
  correct in spirit; we are just plumbing the same pending merge into
  the second toolbar read path it overlooked.
