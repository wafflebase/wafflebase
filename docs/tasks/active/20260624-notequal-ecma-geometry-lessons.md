# Lessons — Not Equal ECMA geometry

## Verify the user's premise against the spec before coding
The request bundled two shapes. One (Bent Up Arrow "should be rounded") was
*wrong* against ECMA-376 — `bentUpArrow` has 3 adjustments and a sharp corner;
only `bentArrow` carries the `adj4` bend-radius. Pulling the verbatim
`presetShapeDefinitions.xml` first turned a "round both" task into "leave one
alone, fix the other," and avoided a deviation from Google-Slides parity.
Lesson: for OOXML shape work, fetch the canonical preset block before trusting
a visual intuition.

## A reverted feature is a clue, not a closed door
`mathNotEqual`'s ECMA port had been tried and reverted (`bfb231ab`) as a
"chunky, broken diagonal." The revert note framed it as "ECMA looks worse" —
but `git show` of the reverted code revealed the real cause: `x7 = hc + xadj2
+ bhw2` (ECMA is `+- hc xadj2 bhw2` = **minus**), which slid the whole slash
off the bars. The maintainer judged a *buggy* render, not the ECMA shape.
Lesson: when re-doing reverted work, diff the reverted commit and find the
actual defect before assuming the design was the problem.

## Translate OOXML guide operators literally
- `+- a b c` → `a + b - c` (not `a + b` then `- c` as separate ops to reorder)
- `*/ a b c` → `a * b / c`
- `?: x a b` → `x > 0 ? a : b` (strictly `> 0`, so `cadj2 == 0` takes `b`)
- `tan a b` → `a * tan(b)` with `b` in 60000ths of a degree
- `mod x y z` → `sqrt(x² + y² + z²)` (vector length, NOT modulo)
A single sign or operator mistranslation produces a plausible-but-broken
polygon that still passes coarse point-in-path checks.

## Angle adjustments are raw 60000ths, handled by `angularHandle`
OOXML angle adjustments (here `crAng`, range 4200000..6600000 = 70°..110°) are
stored verbatim — PPTX import/export pass them through unscaled. The shared
`angularHandle({center, radius, index, spec})` factory converts ↔ radians and
clamps to `spec.min/max` in raw units. Reuse it; don't hand-roll `atan2` math.

## Adjustment ORDER is part of correctness, not just geometry
PPTX import maps `adj1→[0], adj2→[1], adj3→[2]` positionally. Getting the
geometry right but the order wrong (`[bar, gap, angle]` vs ECMA `[bar, angle,
gap]`) silently corrupts every imported file's custom adjustments. Match the
ECMA `avLst` order exactly.

## Cheap visual proof without a real canvas
The test-canvas env is a stub (no pixels). Rasterizing the polygon to ASCII in
a throwaway Node script (point-in-polygon over a grid) gave a fast, dependency-
free "does it look like ≠ and is it self-intersecting" check — exactly the
question the prior revert turned on.
