# Sheet Engine Zoom Support

Add a zoom factor to the sheet engine that affects canvas rendering,
coordinate conversion, and scroll sizing.

## Context

The spreadsheet engine had no zoom support. This adds a `zoom` property
(default 1.0, range 0.5–2.0) to Worksheet, threaded through GridCanvas
and Overlay via `ctx.scale(dpr * zoom, dpr * zoom)`. Coordinate
conversions account for zoom at the rendering boundary — internal layout
stays in logical (unzoomed) space.

## Tasks

- [x] Add `zoom` field, `setZoom`/`getZoom` to Worksheet
- [x] Divide mouse coordinates by zoom in `toRefFromMouse`
- [x] Divide viewport dimensions by zoom in `viewRange` getter
- [x] Multiply output by zoom in `getCellRect` / `getCellRectInScrollableViewport`
- [x] Divide viewport by zoom in `scrollIntoView` visible area check
- [x] Multiply dummy size by zoom in render
- [x] Pass zoom to `GridCanvas.render` and `Overlay.render`
- [x] Scale canvas context by `ratio * zoom` in GridCanvas
- [x] Scale canvas context by `ratio * zoom` in Overlay
- [x] Add `setZoom`/`getZoom` to Spreadsheet facade
- [x] Run `pnpm verify:fast` — all pass

## Notes

- `panBy` is not modified — pan deltas will need zoom division in the
  gesture hook (separate task: mobile-pinch-zoom).
- Layout functions remain in logical space; zoom is applied at boundaries.
