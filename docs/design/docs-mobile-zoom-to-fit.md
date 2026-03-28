---
title: docs-mobile-zoom-to-fit
target-version: 0.3.1
---

# Docs Mobile Zoom-to-Fit

## Summary

Enable mobile-friendly viewing of the Canvas-based document editor by applying
a zoom-to-fit scale when the container is narrower than the page width. This is
the first phase of mobile docs support, focused on reading/viewing; editing
(reflow mode) follows in a later phase.

## Goals / Non-Goals

### Goals

- Pages shrink to fit the viewport with 16px padding on each side
- Scale applies automatically when `containerWidth < pageWidth` (no breakpoint
  or toggle)
- Desktop experience is unchanged (scale factor capped at 1.0)
- Text remains sharp (Canvas `ctx.scale`, not CSS transform)
- Hit-testing (mouse/touch clicks) maps correctly through the scale
- Scrolling, cursor auto-scroll, and peer cursors work at the scaled size

### Non-Goals

- Reflow / content-width adaptation (phase 2)
- Mobile editing UI (toolbar, touch selection, virtual keyboard handling)
- Pinch-to-zoom gesture support
- Horizontal scroll behavior changes

## Proposal Details

### 1. Scale Factor Calculation

In `packages/docs/src/view/editor.ts` `paint()`, compute the scale factor before sizing the canvas:

```
MOBILE_PADDING = 16  // px, each side

pageWidth  = paginatedLayout.pages[0]?.width ?? 0
scaleFactor = Math.min(1, (containerWidth - MOBILE_PADDING * 2) / pageWidth)
```

When `scaleFactor === 1`, all downstream code paths are identical to the current
behavior (multiply/divide by 1 is a no-op).

### 2. Canvas Rendering

`packages/docs/src/view/doc-canvas.ts` `render()` receives `scaleFactor` as a new parameter.

```
ctx.save()
ctx.scale(scaleFactor, scaleFactor)   // <-- new
ctx.translate(0, -scrollY)
// ... existing page rendering (unchanged) ...
ctx.restore()
```

The logical canvas width passed to rendering helpers becomes
`canvasWidth / scaleFactor` so that page centering (`getPageXOffset`) operates
in unscaled document coordinates.

DPR scaling stays in `resize()` (physical pixels); zoom-to-fit scaling is
applied in `render()` (logical coordinates). The two concerns remain separate.

### 3. Hit-Test Coordinate Inversion

`packages/docs/src/view/text-editor.ts` receives a `getScaleFactor` callback
(same pattern as `getCanvasWidth`).

Two methods need adjustment:

**`getPositionFromMouse(e)`:**
```
const s = this.getScaleFactor();
const x = (e.clientX - rect.left + container.scrollLeft) / s;
const y = (e.clientY - rect.top - canvasOffsetTop) / s;
const scrollY = container.scrollTop / s;
```

**`updateDragSelection(clientX, clientY)`:**
Same inversion applied to clientX/clientY before calling
`paginatedPixelToPosition`.

### 4. Scroll Height and Position

In `packages/docs/src/view/editor.ts` `paint()`:

```
// Spacer height scaled down so scrollbar range matches visible size
spacer.style.height = `${totalHeight * scaleFactor}px`

// Convert physical scroll position to logical document coordinates
const scrollY = container.scrollTop / scaleFactor
```

Cursor auto-scroll (`needsScrollIntoView`) compares
`cursorPixel.y * scaleFactor` against the physical viewport bounds.

### 5. Ruler

Scaling the ruler adds complexity disproportionate to its value on mobile.
When `scaleFactor < 1`, the ruler is hidden. When `scaleFactor` returns to 1
(e.g., rotating to landscape on a tablet), the ruler reappears.

```
if (scaleFactor < 1) ruler.hide() else ruler.show()
```

### 6. File Change Summary

| File | Changes |
|------|---------|
| `packages/docs/src/view/editor.ts` | Scale factor calc, spacer height, scrollY inversion, cursor auto-scroll, ruler hide/show, pass getScaleFactor to TextEditor |
| `packages/docs/src/view/doc-canvas.ts` | `render()` accepts scaleFactor, applies ctx.scale, adjusts logical canvasWidth |
| `packages/docs/src/view/text-editor.ts` | Accepts getScaleFactor callback, coordinate inversion in getPositionFromMouse and updateDragSelection |

**Unchanged:** layout, pagination, theme, cursor,
selection, peer-cursor modules, frontend React components.

### 7. Testing

- Unit test for scale factor calculation (various container widths)
- Existing layout/pagination tests unaffected (no changes to those modules)
- Manual verification on mobile viewport sizes (360px, 390px, 430px) and
  desktop (1200px+)

## Risks and Mitigation

| Risk | Mitigation |
|------|------------|
| Text appears too small on narrow phones (scale ~0.4) | Acceptable for viewing; editing phase will use reflow for comfortable text size |
| Coordinate rounding at fractional scale causes 1px cursor drift | Use `Math.round` at the final pixel stage, same as current DPR handling |
| Performance regression from additional ctx.scale call | ctx.scale is a matrix multiply, negligible cost; no layout recomputation |
