---
title: slides-shape-move
target-version: 0.4.2
---

# Slides Shape Move — Ghost Drag & Move Cursor

## Summary

Refine shape drag-move in the slides editor so the gesture matches the
visual language already used for shape-insert hover preview:

- A `move` cursor appears when the pointer is over a **selected** shape,
  signaling that a drag will move it.
- During drag, the original shape and its selection handles stay in
  place. A semi-transparent **ghost** copy of the shape follows the
  cursor at `GHOST_ALPHA` (same constant the insert hover preview uses).
- On pointer release, the shape commits to the new position in a single
  `store.batch()` — same commit pathway as today.

This makes the drag intent explicit ("you are previewing where it will
land"), removes the visual jump that comes from synthesizing a slide
with live frames, and reuses existing ghost-rendering infrastructure in
`slide-renderer.ts`.

### Goals

- Drag-move shapes via ghost preview that follows the cursor.
- Show a `move` cursor on hover over a selected shape's bounding box.
- Keep original shape + selection handles + snap guidelines visible
  during drag (handles anchor to the original frame).
- Commit only on `pointerup`; ESC cancels with no store mutation.
- Reuse the existing `drawSlide(..., ghost?)` path; do **not** add a new
  canvas layer.

### Non-Goals

- Connector drag (current endpoint-based routing is kept — connectors
  are excluded from the ghost path in v1).
- Alt-drag duplicate / clone-while-drag.
- Keyboard arrow-key nudges (single discrete move, no ghost needed).
- Touch-input cursor changes (touch has no cursor concept; ghost
  rendering still applies).
- Group/grouped-shape semantics (current code uses multi-select only).

## Proposal Details

### Affected files

| File | Change |
| ---- | ------ |
| `packages/slides/src/view/canvas/slide-renderer.ts` | `drawSlide(...)` and `forceRender(...)` accept `ghosts?: ReadonlyArray<Element>` instead of `ghost?: Element`. |
| `packages/slides/src/view/editor/editor.ts` | `startDrag()` paints ghosts via `forceRender(originalSlide, doc, ghosts)`; overlay (handles + snap guides) anchored to original frame. New hover-cursor logic on `pointermove` over the canvas. |
| `packages/slides/src/view/editor/overlay.ts` | Accept snap guides as an explicit parameter; do not depend on synthesized live frames. |
| `docs/design/README.md` | Add row linking to this design doc under "Slides". |

### Cursor rules

Applied in the editor's `pointermove` handler (mouse pointers only —
`PointerEvent.pointerType === 'mouse'`):

| Condition | Cursor |
| --------- | ------ |
| Insert mode active (`insertKind !== null`) | `crosshair` (existing) |
| Pointer over a resize/rotate handle | resize/rotate (existing) |
| Pointer inside a **selected** element's bbox (any of the multi-selection) | `move` |
| Pointer inside text-editing element (`editingElementId === el.id`) | `text` / default (no override) |
| Otherwise | `''` (default) |

The check runs against `selection.get()` and the element hit-test
helper already used by `onPointerDown`. Cursor writes go through a
single setter to avoid layout-thrash from repeated assignments to the
same value.

### Ghost rendering pipeline

Today: `drawSlide(ctx, slide, doc, theme, onAssetLoad, ghost?: Element)`
paints all `slide.elements` then, if `ghost` is defined, paints it once
on top at `GHOST_ALPHA`.

Change: accept `ghosts?: ReadonlyArray<Element>`. Iterate the array
after the regular `slide.elements` loop. Each ghost is drawn through
the normal `drawElement` path under a `ctx.save() / ctx.globalAlpha =
GHOST_ALPHA / ctx.restore()` band. Order inside the array preserves
relative z-order of the originals.

`forceRender(slide, doc, ghosts?)` mirrors the same signature.

Call sites:

- `paintWithHoverGhost()` (insert hover preview) wraps its single
  element into `[ghost]`.
- `paintLive()` (drag) builds `ghosts` from the current `selection`:
  ```ts
  const ghosts = selectedElements
    .filter((el) => !isConnector(el))
    .map((el) => ({ ...el, x: el.x + dx, y: el.y + dy }));
  ```
  then calls `this.renderer.forceRender(originalSlide, doc, ghosts)`.
  No synthesized slide is created.

**Connectors during drag (v1 behavior):** Connectors are excluded from
the `ghosts` array. While a drag is in flight they render against their
**original** endpoint geometry — no live re-routing in the preview.
On `pointerup`, the shape commit triggers the normal repaint and any
attached connector picks up the new endpoint via its existing lookup
path. Tracked as a follow-up: live connector re-routing during drag
preview.

### Overlay rules during drag

- Selection handles (corner / edge / rotate) anchor to the **original**
  bbox — they do not move with the ghost.
- Snap guides anchor to the **ghost** bbox — `snapDelta(...)` is still
  called per `mousemove` with the same `bbox`, `otherFrames`, threshold
  inputs as today. Result `{ dx, dy, guides }` feeds: (a) ghost frame
  offset, (b) `renderOverlay(..., guides)`.
- `renderOverlay` gains an explicit `snapGuides` parameter rather than
  inferring guides from the live-frame map (which goes away).

### Commit and cancel

- `pointerup`: `store.batch(() => store.updateElement(id, { x, y }))`
  for each moved element. Identical to current logic. Then clear
  ghost state, `markDirty()`, `render()`, `repaintOverlay()`.
- Pointer leaves canvas mid-drag: current capture pattern via
  `document.addEventListener('pointermove'/'pointerup', ...)` keeps the
  drag alive — no change.
- ESC during drag: drop ghosts, do not call `store.updateElement`,
  `markDirty()` + `render()` + `repaintOverlay()`.

### Tests

Unit tests in `packages/slides/src/view/editor/*.test.ts`:

- `startDrag` → simulated `mousemove` calls `forceRender(slide, doc,
  ghosts)` with `ghosts.length === selection.length` and the synthetic
  offset; the slide argument is unchanged (referential equality with
  original).
- Cursor: `pointermove` over a selected element's bbox sets
  `canvas.style.cursor === 'move'`; over empty space leaves it default.
- Multi-select drag (2 elements) → ghosts array length 2; both offset
  by the same `(dx, dy)`.
- `mouseup` → `store.updateElement` invoked inside one `store.batch`
  with new `(x, y)` per element.
- ESC mid-drag → no `store.updateElement` call; ghost state cleared.

### Risks and Mitigation

| Risk | Mitigation |
| ---- | ---------- |
| `forceRender` signature change cascades through callers | Only one caller today (`paintWithHoverGhost`); update inline. Type-checker will catch any miss. |
| Per-`mousemove` `forceRender` cost with many shapes | Same cost profile as today's live-frame redraw. raf-throttle is already the pattern in `onInsertHoverMove`; apply the same in `startDrag` if profiling shows jank. |
| Connector visual regression during drag | v1 keeps connectors out of the ghost path; tracked as follow-up. |
| Cursor flicker from `style.cursor` writes per `pointermove` | Cache last cursor value; only write when it differs. |
| Touch-input regressions | Cursor logic gated on `pointerType === 'mouse'`; ghost rendering applies to touch too and is the desired behavior on mobile-edit. |
