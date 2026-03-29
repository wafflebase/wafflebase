# Docs Mobile Zoom-to-Fit — Lessons

## Coordinate Space Consistency

The most recurring bug pattern was mixing physical (screen) and logical
(document) coordinate spaces. Every code path that converts between screen
pixels and document coordinates needs scale factor handling:

- **Rendering** (`doc-canvas.ts`): `ctx.scale()` operates in logical coords
- **Hit-testing** (`text-editor.ts`): divide mouse coords by scaleFactor
- **Scroll** (`editor.ts`): `container.scrollTop / scaleFactor`
- **Viewport culling** (`doc-canvas.ts`): `viewportHeight / scaleFactor`
- **Cursor screen rect** (`editor.ts`): use viewport width, not `max(vw, pw)`
- **Link detection** (`text-editor.ts`): same inversion as mouse position

## canvasWidth Must Be Consistent

`getPageXOffset` centers pages based on `canvasWidth`. If rendering and
hit-testing pass different values, page positions differ and clicks land in the
wrong place. When `scaleFactor < 1`:

- Rendering uses `viewportWidth / scaleFactor` as logical canvas width
- Hit-testing must use the same value (not `max(vw, pw) / scaleFactor`)

## Physical vs Logical Width

`Math.max(viewportWidth, pageWidth)` ensures horizontal scroll on desktop.
In scaled mode the page already fits, so `viewportWidth` alone is correct.
Using `max(vw, pw)` when scaled produces a logical width much larger than
the actual viewport, breaking page centering and selection offsets.

## DPR and Zoom-to-Fit Are Separate Concerns

DPR scaling lives in `resize()` (physical pixel backing). Zoom-to-fit scaling
lives in `render()` (logical coordinate transform). Keeping them separate
avoids compounding errors.
