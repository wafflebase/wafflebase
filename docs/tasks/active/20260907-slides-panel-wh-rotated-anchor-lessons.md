# Lessons — Slides panel W/H on a rotated element

## What the bug really was

Not a rendering bug: `frame.x/y` is the top-left of the **unrotated** box
while every consumer (renderer, `toLocal` hit-test, selection overlay)
pivots on the centre. That makes `x` a *derived* quantity for a rotated
element — holding it fixed while `w` changes is what moves the shape. Any
new code path that writes `w`/`h` has to say where the anchor is; there is
no neutral answer.

## Why the anchor rule, not the centre rule

The reporter's wording ("relative to the transform origin") reads as
centre-preserving, but the editor's own drag-resize keeps the *opposite
handle* fixed. Matching the reporter literally would have made an
unrotated W change grow symmetrically — a regression on the common case to
fix the rare one. Anchor-preserving degenerates to today's behaviour at
θ = 0, so the unrotated path needs no test churn.

## Reuse shape

`resizeFrameWorld` already contained the exact math, buried after the
delta-projection step. Splitting it into `frameAtAnchor(start, handle, w, h)`
made the panel path a two-line call and left `resizeFrameWorld`
byte-equivalent in behaviour — worth doing before writing any new
trigonometry.
