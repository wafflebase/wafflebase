# Freeze Pane Line Gap Implementation

## Goal
Add a visual gap between frozen and unfrozen regions so the freeze line
(now drawn at `FreezeHandleThickness = 4px`) does not overlap cell content.

## Tasks

- [x] Add `gapX`/`gapY` fields to `FreezeState` type in `layout.ts`
- [x] Update `NoFreeze` constant with `gapX: 0, gapY: 0`
- [x] Update `buildFreezeState()` to set gap = `FreezeHandleThickness` when frozen
- [x] Update `toRefWithFreeze()` boundary and coordinate calculations
- [x] Update `toBoundingRectWithFreeze()` unfrozen cell position calculations
- [x] Update `gridcanvas.ts` quadrant clip rects with gap offsets
- [x] Update `gridcanvas.ts` column/row header rendering positions
- [x] Update `renderFreezeLines()` — thicker line centered in gap
- [x] Update `renderFreezeHandles()` — handle centered in gap
- [x] Update `overlay.ts` `buildQuadrants()` with gap offsets
- [x] Update `overlay.ts` resize/drag indicator scroll calculations
- [x] Update `renderFreezeDragPreview()` lineWidth to `FreezeHandleThickness`
- [x] Update `worksheet.ts` — all `inFrozenCols`/`inFrozenRows` boundary checks
- [x] Update `worksheet.ts` — `detectFreezeHandle()` positions
- [x] Update `worksheet.ts` — `toRowFromMouse()`/`toColFromMouse()` calculations
- [x] Update `worksheet.ts` — `scrollIntoView()` available space calculations
- [x] Update `worksheet.ts` — `getScrollableGridViewportRect()` insets
- [x] Update `worksheet.ts` — `getCellRectInScrollableViewport()` scroll offsets
- [x] Update `worksheet.ts` — `isAutofillHandleHiddenByFreeze()` boundary
- [x] Update `worksheet.ts` — drag-move snap calculations
- [x] All tests pass (`pnpm verify:fast`)
- [x] Build succeeds (`pnpm sheet build`)

## Review

All changes are mechanical — every place that used `frozenWidth`/`frozenHeight`
as the screen boundary for the unfrozen region now adds `gapX`/`gapY`. The gap
is only non-zero when there are frozen rows/columns.
