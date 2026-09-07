# Slides: panel W/H must resize a rotated element in place

Issue: [#1039](https://github.com/wafflebase/wafflebase/issues/1039)

## Problem

`Format options → Size & Position` commits a size-only frame patch
(`{ w }` / `{ h }`) and leaves `frame.x` / `frame.y` alone. Rotation is
applied around the frame centre `(x + w/2, y + h/2)`, so changing W or H
on a rotated element moves that centre and the element visibly jumps
across the slide instead of resizing in place.

Interactive drag-resize already compensates (`resizeFrameWorld` re-derives
the centre so the anchor handle stays fixed in world space). The panel is
the one size-changing path that skips it.

## Approach

Reuse the anchor math already in
`packages/slides/src/view/editor/interactions/resize.ts` rather than
writing a second copy:

1. Extract the "reposition so the anchor stays fixed in world space" tail
   of `resizeFrameWorld` into a private `frameAtAnchor(start, handle, w, h)`.
2. Add an exported pure `resizeFrameToSize(start, w, h)` that applies it
   with the `se` handle — i.e. the unrotated box's top-left corner stays
   put, which is what a `se` drag produces and what degenerates to
   "leave x/y alone" at rotation 0. Export it from the package index.
3. Frontend: a small `anchoredFramePatch(frame, patch)` helper in
   `format-panel/` widens any patch that touches `w`/`h` with the
   compensated `x`/`y`, applied per element (each has its own rotation).
   Wire it into both `commitFrame` and `lockedResize` in
   `format-panel/index.tsx`.

Deliberately **not** doing: a centre-preserving rule (it would change the
unrotated case to grow symmetrically, inconsistent with drag-resize), and
no MIN_SIZE clamping change on the panel path (out of scope).

## Steps

- [x] Read issue + the four touched files
- [x] `frameAtAnchor` + `resizeFrameToSize` in `resize.ts`, exported from index
- [x] `anchoredFramePatch` in `packages/frontend/src/app/slides/format-panel/`
- [x] Wire `commitFrame` + `lockedResize`
- [x] Unit test: `resizeFrameToSize` keeps the nw corner fixed in world space
- [x] Regression test: panel W commit on a rotated frame (frontend)
- [x] Design doc note in `slides-format-options-panel.md`
- [x] Draft PR

## Acceptance criteria (from the issue)

- Panel W/H change on a rotated element resizes in place, anchored the way
  a drag-resize anchors it (unrotated top-left fixed in world space).
- Unrotated behaviour unchanged (`x`/`y` untouched at θ = 0).
- Applies to `commitFrame` and to `lockedResize` (aspect lock on).
- A regression test asserts the anchor corner's world position is
  unchanged after a panel W/H commit on a rotated frame.
