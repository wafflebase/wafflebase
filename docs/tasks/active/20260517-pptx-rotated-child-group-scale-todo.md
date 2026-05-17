# PPTX import: rotated child + non-uniform group scale overflows group

## Problem

When importing a `.pptx`, shapes with their own rotation that live inside
a `<p:grpSp>` whose `chExt` is sized for the **rotated visual extent**
(the common emission from PowerPoint / Google Slides) overflow the
group's `ext` after import.

Concretely on slide 7 of `Yorkie, 캐즘 뛰어넘기.pptx`, the centre
`rightArrowCallout` (sp id=135) has `rot="5400000"` (90°) and lives
inside a `<p:grpSp>` whose `ext = 1827900 × 1404064` but
`chExt = 1827900 × 2399700` — `chExt.cy` matches the post-rotation
visual height. After import the arrow renders ~503 px tall in a
~295 px slot, breaching the orange "Library" rect that sits above it.

## Root Cause

`applyGroupTransform` in `packages/slides/src/import/pptx/group.ts`
extracts per-axis scales from the cumulative matrix and applies them
to the **unrotated** `frame.w` / `frame.h`:

```ts
const scaleX = Math.sqrt(t.a*t.a + t.b*t.b);  // 1.0
const scaleY = Math.sqrt(t.c*t.c + t.d*t.d);  // 0.585
const w = frame.w * scaleX;                   // unrotated dim, wrong axis
const h = frame.h * scaleY;
```

`frame.rotation` is left out of the sizing math entirely. For a 90°
rotated child, the visually-vertical extent is `frame.w` and the
visually-horizontal extent is `frame.h` — so the X/Y scales have to be
swapped, otherwise the visual bbox after rotation no longer matches the
group's `ext`. For 0° / 180° (current happy path) no swap is needed,
which is why every existing test passed.

For arbitrary rotations the visual bbox after non-uniform scale is a
parallelogram; the closest representable rotated rectangle is found by
solving:

```
w' · |cos θ| + h' · |sin θ| = (w · |cos θ| + h · |sin θ|) · scaleX
w' · |sin θ| + h' · |cos θ| = (w · |sin θ| + h · |cos θ|) · scaleY
```

The system is singular at 45° + k·90° (cos² = sin²); for those we fall
back to the current behaviour since no rotated rectangle can satisfy
both visual extents under non-uniform scale. The same fallback fires
when the closed-form solution turns negative (the regime where no
*positive-sided* rectangle satisfies both extents) — see review note
from `requesting-code-review` pass.

## Plan

- [x] Add a failing unit test in `test/import/pptx/group.test.ts`
      covering a 90°-rotated child inside a group with non-uniform
      `chExt`, asserting the post-transform visual bbox matches the
      group `ext`.
- [x] Implement the visual-bbox-aware scaling in `applyGroupTransform`
      (general 2×2 solve, falling back to the current `w*scaleX` /
      `h*scaleY` when the determinant is degenerate).
- [x] Add a 270° regression test to confirm symmetry. *(Replaced
      after review with a non-axis-aligned 30° solver test and a
      negative-fallback test; pure 270° is degenerate under `|cos|·
      |sin|` and didn't exercise the general solver.)*
- [x] Existing tests cover the rotation=0 / uniform-scale fast paths;
      no extra test needed there.
- [x] Apply review feedback: negative-w/h fallback, off-axis solver
      test, looser singular threshold (1e-6), naming polish, abs-cos
      doc-comment clarification.
- [x] `pnpm verify:fast` green (48 files, 792 tests passing).
- [ ] Manual smoke: re-import `Yorkie, 캐즘 뛰어넘기.pptx`, verify
      slide 7 arrow now fits inside its group. *(Deferred to PR
      review — covered analytically by the new unit test that asserts
      the visual bbox matches the group ext using the exact EMU values
      from slide 7.)*
- [x] Capture lessons.
- [ ] Open PR.

## Notes

- The deck size for this repro is 9144000 × 5143500 EMU (standard
  widescreen 16:9), so `scale.sx ≈ scale.sy` — the non-uniformity comes
  purely from the inner group's `chExt`/`ext` ratio, not the deck-level
  scale. The fix has to live in `applyGroupTransform`, not `parseXfrm`.
- Only the inner-most group is affected here; the bug surfaces whenever
  `(localSx, localSy)` are non-uniform AND the child carries its own
  rotation that is not a multiple of 180°.
- Connectors don't carry their own `rotation`, so they are unaffected.
