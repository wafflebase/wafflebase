# Lessons — PPTX unsupported preset shapes

## What worked

- **Reading the actual PPTX XML before code.** Unzipping the deck and
  reading `slide7.xml` showed the exact `prstGeom prst="..."` + adj
  values, which made the OOXML formula choice unambiguous.
- **Stating the silent-rect fallback as the root cause out loud.**
  `prstToShapeKind() ?? 'rect'` only bumps a quiet counter
  (`report.unknownShapes`); the visible symptom is "shape missing"
  and the cause is invisible without code-spelunking. Naming the
  failure mode in the task doc made the same trap easy to spot in
  the next two slides (28, 31).
- **Adding the natural family, not the three encountered.** 7 arrow
  callouts + 4 brackets/braces instead of just the three the deck
  used, because OOXML siblings would have been the next bug report.
- **End-to-end import smoke (`importPptx` against the real .pptx)
  to confirm the fix before merge.** Unit tests proved
  `prstToShapeKind` resolution and per-builder geometry; only the
  full pipeline confirmed slide 7/28/31 actually rendered as
  expected.

## What to remember

- **Path-builder clamps must mirror in the handle.** When a builder
  clamps `bx = min(w - dx1, w * adj4 / 100000)`, the drag handle's
  `position` and `apply` need the same clamp or dragging enters a
  dead range where adj4 changes but the seam doesn't move. CodeRabbit
  flagged this on `rightArrowCallout`; same pattern existed in 6
  siblings. Lesson: extract the clamp into a shared helper when
  multiple shapes share a formula family.
- **Comment math vs actual math drift is real.** My bracket
  `cornerRadius` was `(min/2) * (a/100000) * 2` with a comment
  saying "% of min(w, h) / 2" — algebraically correct (the `* 2`
  cancels the `/2`) but braces inherited the form WITHOUT the
  `* 2`, silently producing half the radius. Always strip
  cancelling factors and let the comment match the implementation
  literally.
- **Tautological hit-tests don't distinguish shapes from `rect`.**
  Probing `(20, 100)` inside a `leftBracket` with default radius
  ~3px would pass on a plain rectangle builder too. Use max-radius
  adjustments or corner-arc probes to make the test actually
  exercise the shape's defining geometry.
- **Open-path shapes need explicit fill skip.** OOXML brackets/braces
  define separate fill and stroke paths; collapsing to a single open
  polyline means `ctx.fill()` will auto-close into a misleading
  C-rect. Solved with `OPEN_PATH_KINDS` set in `shape-renderer.ts`.
- **OOXML preset name aliases are common.** `homePlate` and
  `pentagonArrow` are the same shape — the spec uses the historical
  name but our internal naming is descriptive. A small `PRST_ALIASES`
  map in `prstToShapeKind()` is the natural extension point; add
  rows here for any future synonym discoveries.

## Won't repeat

- Putting absolute `/Users/<name>/...` paths in committed task
  notes. Replace with sanitized descriptions (the filename alone is
  fine if it identifies the deck, the directory is not).
- Writing builder comments that match the math algebraically but
  not literally (e.g. "% of min/2" when the math is `(min/2) * x * 2`).
  Always normalise the expression so the comment and code are
  syntactically aligned.
- Skipping the test-discrimination check for new shape builders.
  "Does this test fail on a `rect` builder?" is the right yardstick.

## References

- PR #253 — squash-merged as 3e0991fc
- Source deck: `Yorkie, 캐즘 뛰어넘기.pptx` (slides 7 / 28 / 31)
- OOXML preset definitions: ECMA-376 Part 1, Annex A
  (PresetShapeDefinitions.xml)
