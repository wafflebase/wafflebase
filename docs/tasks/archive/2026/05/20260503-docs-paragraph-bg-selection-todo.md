---
title: Docs — selection highlight invisible under inline backgroundColor
date: 2026-05-03
status: done
---

# Docs paragraph/run background hides selection highlight

## Problem

When a text run carries `style.backgroundColor` (Word/Docs-style "highlight"
applied to a paragraph or part of it), the local selection highlight,
peer selection highlight, and search match highlight are all but invisible
inside the colored span.

Root cause is the render order in `packages/docs/src/view/doc-canvas.ts`:

1. Table cell backgrounds (already a separate pre-pass)
2. Search highlights
3. Peer selections
4. Local selection (translucent `rgba(66,133,244,0.3)`)
5. Text runs — and inside `renderRun`, the *opaque* `style.backgroundColor`
   fillRect is drawn here, painting **on top of** steps 2–4.

The same shape exists inside tables: `renderTableContent` paints the inline
run background after the editor's selection layer.

Tables already solved the analogous problem for *cell* backgrounds by
splitting into `renderTableBackgrounds` (pre-selection) and
`renderTableContent` (post-selection). We extend that pattern to inline
run backgrounds.

## Plan (Approach A)

- [x] Capture root cause + plan in this todo
- [x] Add a body pre-pass in `DocCanvas.render` that walks `page.lines` and
      paints each run's `style.backgroundColor`, immediately after table
      cell backgrounds and before the search/peer/local highlight layers
- [x] Add `skipBackground` flag to `DocCanvas.renderRun`; body call sites
      pass `true` so the bg isn't double-painted, header/footer keep
      `false` (no pre-pass there yet — see Risks below)
- [x] In `renderTableBackgrounds`, walk each cell's lines/runs and paint
      inline run backgrounds in the same pass; remove the inline bg fill
      from `renderTableContent`. Extracted `computeCellLineAbsoluteYs`
      so both passes share the verticalAlign / merged-cell math.
- [x] Add `inline run backgroundColor render order` regression tests in
      `packages/docs/test/view/table-renderer.test.ts`
- [x] Verified: image runs are unaffected (skipped via `style.image` check
      in both the body pre-pass and the cell pre-pass)
- [x] `pnpm verify:fast` green (44 test files / 739 tests passed)

Manual visual check (deferred to PR reviewer in #181): type into a
paragraph, apply a yellow highlight, drag-select across it, confirm
the blue selection band is visible over the yellow.

## Risks / Notes

- Header/footer paths (L235, L290 in doc-canvas) also draw selection before
  text. They share `renderRun`/`renderRunWithPageNumber`, so once the bg
  fill is removed from those, headers/footers need their own pre-pass too.
  Decision: keep scope to body + tables for this task; if header/footer
  lose the bg fill entirely the visible behavior is "no inline highlight
  in headers", which is worse than the current bug. → Leave the bg fill
  in `renderRunWithPageNumber` untouched for now (header/footer selection
  vs. inline-bg interaction is a follow-up).
- `dragImageRun`: image runs never had bg painted (early return), so the
  pre-pass should also skip image runs.
