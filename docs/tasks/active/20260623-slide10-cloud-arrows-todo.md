# Slide 10 — cloud shape fidelity + timeline arrow direction

Source reference: `~/Downloads/Yorkie_ 실시간 동시 편집 적용하기.pptx` slide 10
(Google Slides export). Live doc:
https://wafflebase.io/shared/d943de00-fcfe-49f6-afc8-74ef08c23480

Two independent problems on the 10th slide:

## Problem 1 — Cloud shape differs from PowerPoint  ✅ shipped

`buildCloud` (`packages/slides/src/view/canvas/shapes/basic/cloud.ts`) is a
6-lobe heuristic, not the real OOXML `cloud` preset, so the silhouette reads
differently from PowerPoint/Google Slides.

Fix: port the authoritative OOXML `cloud` preset outline (11 elliptical arcs
in a 43200×43200 box) from `presetShapeDefinitions.xml`, mapped to the shape
frame via per-axis scale. This is the exact path PowerPoint draws.

- [x] Replace `buildCloud` with the preset arc sequence (moveTo + 11 arcTo + close)
- [x] Use `Path2D.ellipse` per arc; per-axis radius scale sx=w/43200, sy=h/43200
- [x] Keep the `PathBuilder` signature unchanged; no model/registry change
- [x] Fix test-canvas shim to sample partial elliptical arcs (was full-ellipse)
- [x] Visual check: cloud silhouette matches PowerPoint

## Problem 2 — 2 of 4 timeline arrows point left  ✅ shipped

The timeline arrows are `straightConnector1` connectors with `tailEnd=triangle`.
The two short ones carry `flipH=1` + `rot=10800000` (180°). In PowerPoint
flip+180° cancel on a horizontal line → arrowhead points right. wafflebase
points them left.

Root cause: connectors render in world coords from resolved `start`/`end`
points; the renderer deliberately does NOT apply the frame transform
(`connector-renderer.ts:15-17`). But the importer's free-endpoint fallback
(`import/pptx/shape.ts` `resolveEndpoint`, ~L905-913) bakes in `flipH`/`flipV`
only and **ignores `frame.rotation`**, so flip+rotation never compose.

Fix: in the free-endpoint fallback, compute each endpoint as the proper
flip-then-rotate transform of the box corner about the frame centre
(matches OOXML + `element-renderer` order), instead of the corner-swap.

- [x] Rewrite the free-endpoint fallback to apply flip then rotation about centre
- [x] Verify reduces to current behaviour when rotation = 0
- [x] Add/extend a PPTX import unit test for flipH+rot=180° straight connector
- [x] Visual check on slide 10: all 4 arrows point right

## Problem 3 — "Asynchronous" text left-shifted inside the cloud

In the PPTX the cloud paragraph is `algn="l"` (left), `anchor="ctr"`. It
*looks* centered in PowerPoint only because PowerPoint lays text inside the
cloud preset's `<rect>` (il=2977/21600≈13.8% left, ir=17087/21600 → 20.9%
right inset). wafflebase has no per-shape text rect — `paintShapeText` uses
one uniform `SHAPE_TEXT_PADDING` (≈4.4%) for every shape — so the left-aligned
word hugs the cloud's left edge.

Fix: add a per-`ShapeKind` `SHAPE_TEXT_RECTS` (normalized preset rect),
compose it with the default padding in a shared `shapeTextInset` /
`shapeTextFrame` helper, and route the renderer (`paintShapeText` →
`paintTextBody` asymmetric `inset`) and the editor edit-frame through it so
committed paint and in-place caret agree.

- [x] `SHAPE_TEXT_RECTS` + `shapeTextInset`/`shapeTextFrame` (cloud entry)
- [x] `paintTextBody` accepts asymmetric `inset` (left/top/right/bottom)
- [x] Editor `buildEditTarget` + slow-double-click fallback use `shapeTextFrame`
- [x] Unit test: cloud text inset ≫ uniform 14px; rect unchanged
- [x] Visual check: "Asynchronous" centered under cloud centre line

## Problem 3b — generalize text rects to all shapes (build-time table)

The cloud-only entry fixes the report, but 137 OOXML presets carry a custom
inset text `<rect>`. Hand-maintaining them would drift. Instead generate the
table at build time from the canonical `presetShapeDefinitions.xml`.

- [x] Vendor `presetShapeDefinitions.xml` under `packages/slides/scripts/`
- [x] DrawingML guide evaluator (ops: `*/ +- +/ val pin sin cos tan ?: min max mod at2 cat2 sat2 sqrt abs`; full built-in guide set; avLst defaults) evaluated on the unit square → normalized fractions
- [x] Generator emits `shape-text-rects.generated.ts` (118 kinds) — full-frame, degenerate (`pie`), and the typo'd `leftArrow` source omitted; homePlate→pentagonArrow alias; `upDownArrow` dup de-duped
- [x] `SHAPE_TEXT_RECTS` imports the generated map (dropped hand-coded cloud)
- [x] `pnpm slides gen:textrects` script + `--check` drift guard wired into a unit test; `.prettierignore` for generated file + vendored XML
- [x] Unit tests: generated cloud == known fractions; spot-checks; all-entries-valid; drift

## Verification

- [x] `pnpm verify:fast` green (exit 0)
- [x] Real-browser render check: cloud silhouette + 4 arrows right + text centered
- [ ] Self code-review the branch diff
