# Mobile Pinch-to-Zoom — Lessons

## Engine-level zoom architecture

- Zoom is applied at the rendering/event boundary only. Internal
  coordinate calculations (layout.ts, DimensionIndex) stay in logical
  unzoomed space. This minimizes the number of files that need changes.
- Canvas: `ctx.scale(dpr * zoom, dpr * zoom)` makes all drawing code
  work unmodified — the context transform handles zoom transparently.
- Input: `toRefFromMouse` divides by zoom before cell lookup.
- Output: `getCellRect` multiplies by zoom for screen coordinates.
- Scroll sizer: dummy element = total content size × zoom.
- View range: effective viewport = viewport / zoom.

## Pinch gesture

- Track `pinchStartDist` (initial finger distance) and `pinchStartZoom`
  at gesture start. Scale factor = currentDist / startDist.
  newZoom = startZoom × scale.
- Pan deltas must be divided by zoom — a 10px screen drag should scroll
  less in logical space when zoomed in. Same for inertia velocities.

## What was skipped

- Zoom centering on pinch midpoint: requires adjusting scroll position
  to keep the midpoint stable. Adds complexity for moderate UX gain.
  Can be added later.
- Snap to common zoom levels: YAGNI.
