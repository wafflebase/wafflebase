# Lessons — Heart ECMA geometry

## Prefer native Path2D curves over polyline approximation
The old heart flattened the OOXML cubic Béziers into `polylineArc` segments
plus straight V sides — losing the plump curved silhouette. The TestPath2D
shim already supports `bezierCurveTo` (16-step flatten), and many builders
(round-rect, braces, teardrop, document, wave) use it natively, so the faithful
port is just `moveTo` + 2 `bezierCurveTo` + `close` — fewer lines AND exact.
Lesson: before approximating a preset's curves, check whether the render +
test stack already supports the native curve op.

## Geometry-tied tests live outside the shape's own test file
Changing `heart`'s silhouette broke `select.test.ts`, whose hit-test
assertions encoded the OLD geometry ("lobeR=50, lobe top ≈ y=0", click at
`(150,-3)`). The shape's own `heart.test.ts` is the obvious one to update, but
interaction/hit-test suites can carry hard-coded coordinates for the same
shape. Lesson: after a geometry change, grep the whole package for the shape
kind (`'heart'`) — not just its builder test — and recompute any literal hit
points against the new boundary.

## Compute test points from the real flattening, not by eye
Picked inside/outside and near-edge-tolerance points by running a throwaway
Node script that flattens the Béziers with the SAME 16-step cubic the shim
uses, then point-in-polygon + distance-to-edge. This gave robust assertions
(e.g. the plump-side points `(10,50)`/`(90,50)` that are inside the ECMA heart
but outside the old straight-V) and the exact near-edge point within the 6 px
select tolerance — no flaky sub-pixel guesses.
