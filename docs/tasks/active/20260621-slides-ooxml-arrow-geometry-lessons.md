# Lessons — OOXML arrow geometry port

## What worked

- **Port the spec, don't re-derive it.** circularArrow has ~150 RPN
  guide formulas incl. a line–circle quadratic solve. A small RPN
  evaluator + path interpreter let me transcribe the ECMA formulas
  almost verbatim instead of hand-deriving geometry — far less
  error-prone, and reusable for the other 150+ hand-rolled shapes.
- **Generic numeric drag handle.** Rather than invert each shape's
  adjustment→landmark relationship, a golden-section search over the
  single adjustment that minimises landmark↔pointer distance gives
  correct handles for free (positions come straight from the ahLst
  `pos` guides). Absolute-angle adjustments (circularArrow start/end)
  use a dedicated `presetAngularHandle` (`atan2` about the centre).

## Pitfalls hit

- **DrawingML `arcTo` angles are GEOMETRIC, not the ellipse parameter.**
  The first cut fed `stAng`/`swAng` straight into `(wR cos, hR sin)`,
  which is only right for circles. For `wR ≠ hR` (every curved arrow:
  `wR=w`, `hR≈h/2`) the arc must intersect the ray at the geometric
  angle: `r(g) = wR·hR / hypot(hR cos g, wR sin g)`, point =
  `r·(cos g, sin g)`. This is also what makes the spec's `at2`-derived
  arc angles land exactly on the band/head junction points. The ray
  form is wrap-safe (no `atan2` unwrapping across ±180°). Caught in
  self-review; cardinal-angle tests (square frames, 90° sweeps) hid it
  because geometric == parametric at multiples of 90°. Lock it with an
  off-cardinal elliptical-arc assertion.

- **`*/` inside a JSDoc comment closes the block comment.** Writing
  ``e.g. `"*/ ss adj1 100000"` `` in a `/** … */` doc terminated the
  comment early and broke the file. Don't put `*/` in TS comments.
- **Angle convention.** DrawingML / `polylineArc` use screen-down y, so
  parametric 90° = down, 270° = up. The default circularArrow band
  sweeps 180°→~344° (left→top→right), opening at the *bottom* — got the
  band-fill test point wrong twice before checking the dumped guides.
- **`+-` formulas with a redundant trailing operand** exist in the
  spec (e.g. `"+- xH 0 dxB 0"`). Fixed-arity ops must read only the
  operands they need and ignore extras.
- **pdf-lib was uninstalled locally**, making two unrelated PDF tests
  fail; `pnpm install` fixed it. Not caused by this change.

## `fill="darkenLess"` is shading, not silhouette

The biggest visual bug came from treating DrawingML's multi-`<path>`
shapes as a union of filled regions. The curved arrows carry a
`fill="darkenLess"` (and `fill="none"` outline) path *in addition* to
the norm body path. `darkenLess`/`lighten`/etc. are 3-D shading
overlays drawn over a *sub-region* in a modified shade — NOT extra
silhouette. Flat-filling them painted a big wrong blob and made the
band look broken (worse on rectangular frames). Fix: render only `norm`
(or fill-less) silhouette paths; skip `none` + all shading variants.
The norm body path is already the complete outline, which also removed
the earlier body/head stroke seam. User caught this ("square connects,
rectangle disconnects") — aspect-ratio-dependent visual bugs point at
the geometry/compositing, not the data.

## Known limitations (documented in the todo)

- The preset engine is wired only to these 7 shapes for now.
- Existing saved shapes that stored custom `adjustments` reinterpret
  under OOXML semantics (accepted; they were broken before).
