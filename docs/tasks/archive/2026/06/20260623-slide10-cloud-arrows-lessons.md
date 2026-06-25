# Lessons — slide 10 cloud + timeline arrows

## Port preset geometry verbatim, don't re-invent it

The previous `buildCloud` was a hand-tuned 6-lobe heuristic. It was never
going to match PowerPoint because PowerPoint draws the exact OOXML `cloud`
preset (11 elliptical `arcTo` bumps from `presetShapeDefinitions.xml`). The
right fix for "matches PowerPoint" is to copy the authoritative preset path
(found in docx4j's `presetShapeDefinitions.xml`) and map it through the frame
with a per-axis scale — not to tweak a heuristic. `Path2D.ellipse` maps an
OOXML `arcTo` directly: centre = current − (wR·cosθ, hR·sinθ), then sweep.

## Connector flip + rotation must compose at import time

Connectors render in **world coordinates** from resolved `start`/`end`
points; `connector-renderer.ts` deliberately does NOT apply the per-element
frame transform. So any `flipH`/`flipV`/`rot` from `<a:xfrm>` must be **baked
into the resolved endpoints** during import. The bug: `resolveEndpoint`
applied flip only and ignored rotation, so a `flipH=1` + `rot=180°` straight
connector (where the two cancel on a horizontal line) put the arrowhead on the
wrong side. Fix: transform the box corner about the frame centre — flip then
rotate — matching OOXML and `element-renderer`'s rotate-then-scale order.

Rule: when a model stores absolute geometry separately from a `frame` that
also carries rotation/flip, check WHICH layer consumes the transform before
"fixing" either — applying it in both double-counts; applying it in neither
drops it.

## The jsdom test-canvas shim modelled partial arcs as full ellipses

`test-canvas-env.ts` recorded every `ctx.ellipse()` as a *full* ellipse op
for hit-testing (fine for donut/can lids) but wrong for partial elliptical
arcs — the cloud's interior test failed even though the real-browser winding
was correct (verified out-of-band). Fixed the shim to sample partial arcs into
polylines, exactly as it already did for partial `arc()`. Lesson: when a
geometry test fails, confirm whether the failure is in the geometry or in the
test's approximation of the canvas before changing the geometry. The
registry-snapshot churn was real but contained to the 6 partial-ellipse
shapes; pure-polygon shapes were untouched (verified with a per-key diff).

## "Looks centered" can be left-aligned text in a preset text rect

The cloud text is `algn="l"` (genuinely left-aligned). It reads centered in
PowerPoint only because PowerPoint lays text inside the preset's inset
`<rect>` (cloud: ~13.8% left / 20.9% right). wafflebase used one uniform
`SHAPE_TEXT_PADDING` for all shapes, so left-aligned text hugged the edge.
Don't assume a visual "centered" means `algn="ctr"`; check the preset text
rectangle. Fix added a per-`ShapeKind` `SHAPE_TEXT_RECTS` composed with the
default padding, threaded through one `shapeTextInset`/`shapeTextFrame` helper
so renderer paint and editor caret stay aligned.

## Generate preset data, don't hand-maintain it — and expect source quirks

When the per-shape text rect grew from "just cloud" to "all 137 inset presets,"
the right move was a build-time generator over the canonical
`presetShapeDefinitions.xml` + a small DrawingML guide-formula evaluator, not a
hand-typed table. The evaluator only needed ~16 ops and the built-in guide set;
evaluating on a unit square yields normalized fractions directly. Validate it
by reproducing a known value (cloud `il=2977/21600`) before trusting the rest.

The canonical preset file has real-world quirks the generator must absorb:
CRLF line endings (Python's text mode hid this; Node's `readFileSync` did not —
normalize first); `upDownArrow` defined twice (de-dupe by kind); `pie`'s rect is
sweep-angle dependent and collapses to zero width at the default adjustment
(skip degenerate rects); and `leftArrow`'s source references an undefined guide
`dy` (a known ECMA typo) — let it fall back to uniform padding rather than
hard-code a fix. Guard each of these explicitly and log what was skipped.

Pin generated output two ways: a unit test on known values AND a `--check`
mode run from a test so a stale checkout fails. Prettier-ignore the generated
file and vendored data so the generator stays the single formatting authority
(otherwise prettier rewraps an 80+ char line and the drift check fails).

## Pre-existing env drift surfaced mid-task

`verify:fast` first failed on a stale slides `dist` (missing `exportPptx` from
#407) and an uninstalled `jszip` (declared in the CLI's package.json but never
installed). Neither was caused by this task. `pnpm --filter @wafflebase/slides
build` + `pnpm install` cleared both. Matches the known "rebuild the workspace
package on missing-export failures" memory.
