# Heart — ECMA-376 geometry fidelity

## Context

`heart` was implemented as a polyline approximation: two semicircular top
lobes (radius `w/4`) + a **straight V** down to the bottom tip. The OOXML
preset is two cubic Béziers whose control points reach above the top
(`y1 = −h/3`) and beyond the sides (`x4 = 73w/48`, `x1 = −25w/48`),
producing rounded lobes and **curved** sides that bulge then taper to the
tip. The current shape reads as angular/spade-like in the lower half.

`bezierCurveTo` is used natively by many builders (round-rect, braces,
teardrop, document, wave) and is supported by the TestPath2D shim
(16-step cubic flatten), so heart can be ported **exactly** — no polyline
approximation, drop the `polylineArc` import.

## ECMA-376 `heart` reference (verbatim)

```
gdLst:
  dx1 = */ w 49 48          # = w*49/48
  dx2 = */ w 10 48          # = w*10/48
  x1 = +- hc 0 dx1          # hc - dx1  (≈ -0.52w, off left)
  x2 = +- hc 0 dx2          # hc - dx2
  x3 = +- hc dx2 0          # hc + dx2
  x4 = +- hc dx1 0          # hc + dx1  (≈ 1.52w, off right)
  y1 = +- t 0 hd3           # 0 - h/3   (above top)
path:
  moveTo (hc, hd4)                                  # centre dip, y=h/4
  cubicBezTo (x3,y1) (x4,hd4) -> (hc, b)            # right lobe -> bottom tip
  cubicBezTo (x1,hd4) (x2,y1) -> (hc, hd4)          # tip -> left lobe -> dip
  close
```
(hc=w/2, hd4=h/4, hd3=h/3, t=0, b=h.)

## Plan / checklist
- [x] Rewrite test first (TDD): plump curved sides `(10,50)`/`(90,50)` inside
      (would be outside the old straight-V); lobes inside; bottom tip inside;
      dip notch `(50,10)` outside; top corners outside.
- [x] Replace `buildHeart` body with `moveTo` + 2 `bezierCurveTo` + `close`
      from the ECMA guides; drop the `polylineArc` import.
- [x] Regenerate registry snapshot; confirm ONLY the `heart` key changed.
- [x] Slides tests + typecheck green (only the pre-existing `player.test.ts`
      `.at()` gap remains).
- [x] Self code-review over branch diff.
- [x] Update parity task line ("heart … polyline-approx; low priority").

## Review

Shipped in **PR #413** (`b2d158c7` — "Slides: match Not Equal + Heart to
ECMA-376 preset geometry"). `heart.ts` is now `moveTo(hc,hd4)` + two
`bezierCurveTo` + `close` per the ECMA-376 guides; registry snapshot
updated. Boxes reconciled post-merge (the todo shipped with the PR but
the checklist was left unticked).
