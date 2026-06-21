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

## Known limitations (documented in the todo)

- Single-`Path2D` renderer fills the body+head union correctly but
  strokes each subpath boundary, so a faint seam can appear at the
  body/head junction of curved arrows when a stroke is set.
- The preset engine is wired only to these 7 shapes for now.
- Existing saved shapes that stored custom `adjustments` reinterpret
  under OOXML semantics (accepted; they were broken before).
