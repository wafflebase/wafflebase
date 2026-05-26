# PPTX blipFill `<a:stretch><a:fillRect>` cover-crop support

## Problem

Importing a PPTX where a photo is placed as a `<p:sp>` freeform shape with
`<a:blipFill>` (not a `<p:pic>`) distorts the image when the shape's frame
aspect ratio differs from the photo's. PowerPoint reconciles the mismatch with
a **negative `<a:stretch><a:fillRect>`** (Fill/cover crop): it scales the image
larger than the shape and clips it. Our importer (`parseBlipFill`) only reads
`<a:srcRect>` and ignores `<a:stretch><a:fillRect>`, so with no crop the
renderer stretches the whole image into the frame → squish.

Repro deck: "Blue Green Colorful Daycare Center Presentation.pptx"
- Slide 3, Freeform 15: `image50.jpeg` 1200×1800 (2:3) into a square frame
  (`ext 6350000×6349974`, AR 1.0) with `fillRect l="-31963" t="-36905"
  r="-9496" b="-75284"`. Fill-region AR = 0.667 = native AR (so PowerPoint
  shows it undistorted).
- Slide 8: 3 more negative `fillRect`s.

## Root cause

`packages/slides/src/import/pptx/image.ts` `parseBlipFill()` derives `Crop`
only from `<a:srcRect>`. `<a:stretch><a:fillRect>` (destination cover-crop) is
never read. Renderer `image-renderer.ts` then hits the no-crop `drawImage(img,
0, 0, w, h)` full-stretch branch.

## Fix

The crop infrastructure already exists end-to-end (`Crop` type, optional
`ImageElement.data.crop`, renderer source-rect path, `srcRect` import). A
negative/zero `fillRect` is mathematically equivalent to a source crop:

```text
l,t,r,b = insets / 100000
fw = 1 - l - r ; fh = 1 - t - b
crop = { x: -l/fw, y: -t/fh, w: 1/fw, h: 1/fh }
```

In `parseBlipFill`, when `srcRect` yields no crop, fall back to deriving a crop
from `<a:stretch><a:fillRect>`. Only apply when the result is a valid
sub-rectangle within `[0,1]` (the cover case). Default (all-zero) → no-op;
positive insets (letterbox) → skip (keep current behavior). No model/renderer
changes.

Limitation (documented): `srcRect` takes precedence; we do not compose
`srcRect` + `fillRect` (rare). Non-rect freeform clip paths still not honored
(pre-existing v1 limitation).

## Steps

- [x] Write failing unit test in `packages/slides/test/import/pptx/image.test.ts`
      for negative `fillRect` → expected cover crop (use slide-3 Freeform 15 values).
- [x] Add no-op (all-zero fillRect), positive-inset (skip), and srcRect-
      precedence assertions.
- [x] Implement `parseStretchFillRect` fallback in `image.ts`.
- [x] `pnpm --filter @wafflebase/slides test` green (1300 tests).
- [x] `pnpm verify:fast` green.
- [x] Self code-review over branch diff (subagent: Ready to merge=Yes; applied 2
      minor nits, declined 1 with reasoning).
- [x] Open PR — #297.

## Review

Root cause exactly as predicted: `parseBlipFill` read only `<a:srcRect>` and
dropped `<a:stretch><a:fillRect>`. Fix derives the equivalent source `Crop`
from the negative fillRect (cover case only), reusing the existing crop
pipeline — no model or renderer change (`image.ts` +48/-1).

**End-to-end verification** against the real deck (temporary jsdom test, since
removed): slide 3 (display order = `slide3.xml`) yields 29 images, exactly 1
cropped — the portrait photo nested inside a `<p:grpSp>` — with
`crop = {x:0.22595, y:0.17393, w:0.70692, h:0.47128}`. Cropped-source pixel AR
= (0.70692·1200)/(0.47128·1800) ≈ 1.0 = the square frame AR ⇒ no distortion,
matching PowerPoint. (Caught a debug-only mistake: the first pass filtered only
top-level elements and missed the grouped photo; recursion confirmed the fix.)

Also fixes the 3 negative-fillRect shapes on slide 8.

**Limitations (accepted for v1):** `srcRect` takes precedence — `srcRect` +
`fillRect` are not composed; positive-inset (letterbox) fillRects fall back to
full stretch; `<a:tile>` fills unchanged; non-rect freeform clip paths still
not honored (pre-existing).

**Note:** Only affects *new* imports. The already-shared document was imported
before the fix and must be re-imported to pick up the corrected crop.
