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

## Multi-`<path>` curved arrows: fill the union, stroke a separate outline

The curved arrows carry THREE `<a:path>`s: a `norm` body, a
`fill="darkenLess"` curl, and a `fill="none"` outline. Two wrong turns
before landing it (user corrected both):

1. First treated `darkenLess` as a same-colour fill and unioned it →
   correct shape but a stroked **seam** across the body/curl junction;
   on rectangular frames the contrast made it look disconnected.
2. Then assumed `darkenLess` was pure shading and dropped it (body
   only) → **distorted**: the body alone is missing the upper curl. The
   user: "square: pre-fix shape was right; current is distorted."

Reality: `darkenLess` IS part of the silhouette (PowerPoint just shades
it for 3-D). The body + curl union is the true filled shape (correct at
every aspect ratio). The seam was only a *stroke* artifact — stroking
the internal shared edge. PowerPoint fills the union but strokes the
`fill="none"` **outline** (the true perimeter). So: `PATH_BUILDERS`
fills the union, a new `OUTLINE_BUILDERS` provides the perimeter, and
the renderer strokes that. `PresetShapeDef.outline` carries the open
outline command list; `buildPresetOutline` renders it.

Lesson: a flat renderer of DrawingML multi-path shapes generally wants
fill = union of filled sub-paths, stroke = the `fill="none"` outline.
Bumped preset arc resolution to 64/turn so the eccentric fill arcs and
the separate stroke outline stay visually coincident at the junction.

## Known limitations (documented in the todo)

- The preset engine is wired only to these 7 shapes for now.
- Existing saved shapes that stored custom `adjustments` reinterpret
  under OOXML semantics (accepted; they were broken before).
