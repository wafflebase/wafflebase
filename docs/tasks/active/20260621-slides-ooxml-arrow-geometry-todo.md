# Slides — faithful OOXML geometry for curved/circular/swoosh arrows

## Problem

`swooshArrow`, `circularArrow`, and the four `curved*Arrow` shapes (plus
`uturnArrow`) render with inaccurate geometry and broken arrowheads. The
current builders are hand-rolled "V0" approximations — the code comments
admit it (curved arrows: *"the tip is a single point — the arrowhead does
not flare wider than the band"*). They do not implement the real OOXML
preset geometry, so the arrowhead at the head end is missing/wrong.

## Root cause

No OOXML preset-geometry evaluator exists. Every shape (158 files) is a
bespoke TypeScript path builder, and PPTX import just maps preset names to
these builders (`import/pptx/geometry.ts`). The arrow builders diverge from
the ECMA-376 `presetShapeDefinitions.xml`:

- **swooshArrow** — OOXML is a thin quadratic-Bézier swoosh with a flared
  head; current uses corner-centred elliptical arcs (wrong shape).
- **circularArrow** — OOXML computes the head tip via a full line–circle
  intersection solve (~150 guide formulas, 5 adjustments); current uses a
  fixed 300° sweep + single radial spike.
- **curvedRight/Left/Up/Down** — OOXML flares the head wider than the band
  (`aw` > `th`); current makes the tip a single point.
- **uturnArrow** — head/bend geometry diverges from OOXML.

## Approach (decided with user)

Build a small, reusable **OOXML preset-geometry engine** and define these
shapes from their verbatim preset formulas. Adopt OOXML adjustment
semantics & defaults (existing niche saved shapes may shift appearance —
documented known limitation; they are broken today anyway).

Scope the engine's *use* to the 7 affected shapes for this PR; the engine
itself is general (benefits the other 150+ shapes & PPTX import later).

## Plan

### Phase 1 — Engine (TDD)
- [x] `preset/formula.ts` — RPN guide evaluator + built-in guides
  (`w h ss ls l t r b hc vc wd2 wd4 wd6 hd2 hd6 ssd8 cd2 cd4 3cd4 …`).
  Operators: `val */ +- +/ pin abs sqrt max min ?: mod sin cos tan at2
  cat2 sat2`. Angles in 60000ths of a degree.
- [x] `preset/path.ts` — path-command interpreter → `Path2D`:
  `moveTo lnTo arcTo(wR,hR,stAng,swAng) quadBezTo cubicBezTo close`.
  `arcTo` decomposes to `polylineArc` (center = cur − (wR cos, hR sin));
  béziers flattened to polylines (one code path for tests + prod, per
  curves.ts precedent). Multi-`<path>` shapes: union all `fill != "none"`
  closed subpaths into one Path2D (nonzero) — faithful fill.
- [x] `preset/types.ts` — `PresetShapeDef { adj, guides, paths }`.
- [x] Unit tests: formula ops, arcTo center/endpoint math, a known shape.

### Phase 2 — Shape specs (transcribed from ECMA-376)
- [x] swoosh-arrow.ts — rewrite to preset spec
- [x] circular-arrow.ts — rewrite to preset spec (5 adj)
- [x] curved.ts (shared) → curvedRight/Left/Up/Down preset specs
- [x] uturn-arrow.ts — rewrite to preset spec
- [x] Keep each file's `buildXxx`, `XXX_ADJUSTMENTS`, `XXX_HANDLES`
  exports so `index.ts` wiring is untouched.
- [x] Handles: positions from preset guides (ahLst pos); apply functions
  consistent with the new OOXML adjustment model.

### Phase 3 — Tests + verify
- [x] Update per-shape tests (adjustment counts/handles changed).
- [x] `pnpm --filter @wafflebase/slides test` green.
- [x] `pnpm verify:fast` green.
- [ ] Browser smoke: insert each shape, confirm arrowheads render (pre-merge).

## Known limitations / non-goals
- Connection sites (`cxnLst`) and `ahPolar` exact drag inverse parity not
  ported beyond what the shapes need.
- Engine not yet applied to the other 150+ shapes (future work).

## Post-review fixes
- arcTo angles are geometric (ray), not the ellipse parameter — fixed
  with a ray–ellipse intersection (commit 2).
- Curved-arrow bend looked broken / disconnected on rectangular frames:
  the engine was flat-filling the `fill="darkenLess"` 3-D shading overlay
  as if it were silhouette. Now only norm silhouette paths render; the
  body path alone is the complete outline at every aspect ratio. Also
  removes the body/head stroke seam (commit 3).

## Review
(to fill in)
