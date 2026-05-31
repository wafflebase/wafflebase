# Lessons — Slides flip keeps text readable

## OOXML flip semantics differ between geometry and text

`<a:xfrm flipH/flipV>` mirrors a shape's geometry but PowerPoint / Google
Slides keep the text glyphs inside that shape upright. Our renderer was
applying `ctx.scale(-1, 1)` to the entire element transform, flipping
both. The fix is a centred counter-flip applied only around text
painting — centred flip is its own inverse, so applying the same
operation again around the same centre absorbs the accumulated flip
without disturbing rotation or scale.

## Threading boolean state through recursive renderers

Groups containing flipped children need the accumulated flip from
ancestors, not just the own flip. `XOR` (`parent.h !== own.h`) is the
correct accumulation for a boolean toggle flag: an even number of flips
cancels out, an odd number flips. Same pattern would apply to any
boolean state (visibility, locked, etc.) that propagates through a
group hierarchy.

## Hit-test invariant stayed valid

`element-hit.ts:108-109` inverts `flipH`/`flipV` to test against the
un-flipped local `Path2D`. That logic is correct because the geometry
*still* mirrors (only text un-mirrors), so the path itself remains the
target the inversion was designed for. No hit-test change needed —
worth verifying before any flip-semantics refactor that touches
neighbouring logic.

## What was non-obvious

The interaction with `withCounterFlip` and the existing image-rendering
path: images intentionally keep flipping (user flipping a picture →
mirror image is the desired behavior). Only text counter-flips. Image
runs and shape geometry continue under the flipped transform.
