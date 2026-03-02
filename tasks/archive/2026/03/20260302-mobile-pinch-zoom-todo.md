# Mobile Pinch-to-Zoom

Add pinch gesture support for zooming the spreadsheet viewport on mobile.

## Context

Multi-touch gestures are currently blocked in `use-mobile-sheet-gestures.ts`
(returns early if `touches.length > 1`). Pinch-to-zoom would allow users
to zoom in for precise editing or zoom out for overview navigation.

## Tasks

- [x] Detect pinch gesture (two-finger touch with changing distance)
  - Track initial distance between two touch points
  - Calculate scale factor from distance delta
- [x] Apply zoom level to spreadsheet rendering
  - Added engine-level zoom: ctx.scale(dpr * zoom) on both canvases
  - Coordinate conversions account for zoom at rendering boundary
- [~] Zoom centered on midpoint between two fingers — deferred
- [x] Define zoom limits (50%–200%)
- [~] Snap to common zoom levels on gesture end — skipped (YAGNI)
- [x] Ensure pan gesture still works correctly after zoom change
  - Pan deltas and inertia velocities divided by zoom
- [x] Update coordinate mapping for touch → cell resolution at non-100% zoom
- [x] Run `pnpm verify:fast` and confirm pass
