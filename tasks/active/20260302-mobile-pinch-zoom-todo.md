# Mobile Pinch-to-Zoom

Add pinch gesture support for zooming the spreadsheet viewport on mobile.

## Context

Multi-touch gestures are currently blocked in `use-mobile-sheet-gestures.ts`
(returns early if `touches.length > 1`). Pinch-to-zoom would allow users
to zoom in for precise editing or zoom out for overview navigation.

## Tasks

- [ ] Detect pinch gesture (two-finger touch with changing distance)
  - Track initial distance between two touch points
  - Calculate scale factor from distance delta
- [ ] Apply zoom level to spreadsheet rendering
  - Investigate existing zoom support in the sheet engine
  - If none exists, may need canvas scale transform + coordinate mapping
- [ ] Zoom centered on midpoint between two fingers
- [ ] Define zoom limits (e.g., 50%–200%)
- [ ] Snap to common zoom levels on gesture end (optional)
- [ ] Ensure pan gesture still works correctly after zoom change
- [ ] Update coordinate mapping for touch → cell resolution at non-100% zoom
- [ ] Run `pnpm verify:fast` and confirm pass

## Notes

This task has higher complexity because the sheet engine may not have
built-in zoom support. Investigate first before committing to implementation.
