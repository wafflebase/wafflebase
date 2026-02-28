# Clickable Hidden Indicator — Unhide on Click

## Task
Add click-to-unhide interaction for hidden row/column boundary markers.
Hovering shows pointer cursor and thicker marker; clicking unhides adjacent hidden rows/columns.

## Checklist

- [x] Add `HiddenIndicatorHitThreshold` constant (8px)
- [x] Add `hiddenIndicatorHover` field to `Worksheet`
- [x] Implement `detectHiddenIndicator()` method
- [x] Update `handleMouseDown` priority: Freeze → Hidden indicator → Resize
- [x] Update `handleMouseMove` priority: Freeze → Hidden indicator → Resize
- [x] Add `setHiddenIndicatorHover()` helper
- [x] Update `handleScrollContainerMouseLeave` to clear hover
- [x] Update `handleDblClickAt` to handle hidden indicator (prevent autofit)
- [x] Pass `hiddenIndicatorHover` to `gridCanvas.render()`
- [x] Update `renderHiddenRowIndicators` with hover feedback (5px, `resizeHandleColor`)
- [x] Update `renderHiddenColumnIndicators` with hover feedback
- [x] All tests pass (`pnpm verify:fast`)

## Review

All changes implemented in 2 files:
- `packages/sheet/src/view/worksheet.ts` — detection, click handling, hover state
- `packages/sheet/src/view/gridcanvas.ts` — hover rendering feedback

548 tests pass, lint clean.
