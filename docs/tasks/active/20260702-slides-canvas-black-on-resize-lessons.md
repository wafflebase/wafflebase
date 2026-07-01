# Lessons — slides canvas black on sidebar toggle

## Bug shape: unconditional clear + conditional redraw

The class of bug: a destructive operation (reassigning `canvas.width`
clears the backing store) paired with a redraw that is delegated to
change-detecting setters. When the setters' inputs don't change they
early-return without repainting, so the cleared surface is never
redrawn. Whenever you clear a canvas, the repaint after it must be
unconditional (or gated on "did I clear?", not on "did some unrelated
input change?").

## Why the fix is surgical, not a blanket repaint

A blanket `markDirty(); render()` after every refit would double-paint
on host-change frames (setHostSize already repaints them). The predicate
`canvasChanged && !hostChanged && !offsetChanged` fires on exactly the
frame where neither setter repaints — single paint in all cases, no perf
regression during the 200ms sidebar transition (which drives many
ResizeObserver frames).

## Known test-coverage gap (accepted)

The load-bearing logic is the call-site wiring in `refitCanvas`
(slides-view.tsx): capturing `offsetChanged` *before* the offset
reassignment, and the `!sameCanvas`/`!sameSlide` mapping. That closure
is not cheaply unit-testable — it captures ~10 mutable outer bindings and
many DOM refs, and jsdom returns `null` from `canvas.getContext('2d')`
(the frontend test env has no `test-canvas-env` shim, unlike the slides
package). Mounting the full `SlidesView` would need a Yorkie doc + canvas
context stub — disproportionate to the fix.

We extracted the non-obvious repaint condition into a documented,
unit-tested predicate (`needsForcedRepaintAfterRefit`). The predicate
test locks the intent; the call-site wiring is verified by manual smoke
(Fit zoom + repeated sidebar toggle). If this closure is ever refactored,
that is the moment to add a jsdom `refitCanvas` test with a mock editor.

## Latent follow-up (out of scope)

`dpr` is captured once at mount (slides-view.tsx `window.devicePixelRatio`)
and never re-read, so the host bitmap scale can diverge from the engine's
`options.dpr` when a window moves between monitors of different DPR.
Untouched here; worth a separate task.
