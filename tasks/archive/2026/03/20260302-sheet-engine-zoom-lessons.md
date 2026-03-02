# Sheet Engine Zoom — Lessons

## What went well

- The `ctx.scale` approach means all existing drawing code works
  unmodified — only the scale factor changes from `dpr` to `dpr * zoom`.
- Keeping layout functions in logical space avoids cascading changes
  through the entire codebase.
- The boundary-only approach (zoom at input/output, not in layout) makes
  the change small and localized.

## What to watch

- Mouse coordinate methods beyond `toRefFromMouse` (e.g.,
  `detectResizeEdge`, `toRowFromMouse`, `toColFromMouse`,
  `detectHiddenIndicator`, `detectAutofillHandle`) also receive raw
  screen coordinates. At zoom=1 this is fine, but they will need zoom
  division if non-1.0 zoom is used interactively with these features.
  This is acceptable for now since pinch-zoom gesture integration is a
  separate follow-up task.
- The `getAutofillSelectionRect` method computes rects in logical space
  and compares with mouse coordinates. This will need zoom adjustment
  when autofill is used at non-1.0 zoom levels.
