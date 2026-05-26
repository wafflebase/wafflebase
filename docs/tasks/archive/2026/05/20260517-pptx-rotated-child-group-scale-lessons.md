# Lessons — PPTX rotated child + non-uniform group scale

## What I almost got wrong

Initial instinct on seeing "scale child by per-axis matrix scale" was
that the math was already correct — every prior test passed, including
one explicitly named "rescales when chExt differs from ext". Easy to
walk away thinking the import is fine.

The trap is that the existing "non-uniform scale" coverage used a
**uniform** 0.5× scale (2000000 / 1000000 in both axes), and the
"rotated group" coverage used uniform 200×200 groups (`localSx ==
localSy`). The dangerous combination — rotated child + non-uniform
local scale — had no test, so the bug shipped.

## Generalisable lesson

When auditing a coverage matrix, count *combinations*, not features:
"we have a rotation test" + "we have a non-uniform scale test" does
NOT imply "we have a rotation × non-uniform scale test". For transform
code where features compose, the bug always lives in the off-diagonal
cells.

## OOXML emission detail worth remembering

PowerPoint / Google Slides set `<a:chOff>` / `<a:chExt>` to the
**visual rotated** bbox of children, not the unrotated bbox. So if a
single child has `rot="5400000"` (90°) with `<a:ext cx="A" cy="B"/>`,
the enclosing group will emit `<a:chExt cx="B" cy="A"/>` — swapped.
Any importer that "scales the unrotated dims" will end up off-axis.

## Solver shape

For per-axis scale (sx, sy) applied to a rectangle of size (w, h)
rotated by θ, the rotated rectangle whose visual bbox matches the
scaled visual bbox is the solution of:

    [|cos θ| |sin θ|] [w']   [(w|cos θ| + h|sin θ|) · sx]
    [|sin θ| |cos θ|] [h'] = [(w|sin θ| + h|cos θ|) · sy]

Determinant = cos(2θ). Singular at 45° + k·90°, where no axis-aligned
rectangle satisfies both scaled visual extents — fall back to
unrotated scaling for those.

For θ = 0: identity → matches existing behaviour.
For θ = 90°: swaps sx ↔ sy on h and w — the most common real case.

## Verification gap I should be honest about

End-to-end "re-import the PPTX and verify slide 7 visually" was not
performed locally — the unit test asserts the post-transform visual
bbox matches the group `ext` using the exact EMU values from slide 7,
which is strong evidence but not a pixel-perfect screenshot diff. The
manual smoke is deferred to PR review.

## Lesson from the code review pass

First pass shipped a 270° "symmetry" test that ran the same code path
as the 90° test (because `|cos|`/`|sin|` make rotation
quadrant-invariant) — looked like additional coverage, was actually
redundant. Reviewer caught it. **Whenever a fix uses absolute values
to collapse symmetries, every "symmetry" test added afterward is
suspect: it might be exercising the same branch.** The genuine
coverage dimension here is *off-axis* rotation, where cos·sin ≠ 0.

Reviewer also caught a latent corruption mode: for sufficiently
non-uniform scale at off-axis angles, the algebraic solver returns
negative w'/h'. Two-line guard fixes it (fall back to per-axis
scaling). I'd derived the math for the dominant case (axis-aligned)
and not stress-tested the solver outside it. **Whenever you ship a
closed-form solver, pick a torture-test input in a different regime
and trace by hand before claiming the math covers the general case.**
