# OOXML shape parity — full audit + fix sweep

Goal: compare every slides shape path-builder against the canonical ECMA-376
preset geometry (`presetShapeDefinitions.xml`) and bring each into agreement,
one by one, until complete.

Reference: `.ooxml-preset-ref.xml` (gitignored, copy of ECMA-376 presets).
Coordinate decode: l=0 t=0 r=w b=h, y DOWN; angles 0°=+x, +90°(cd4)=+y CW;
arcTo center = cur − (wR·cosSt, hR·sinSt), end = center + (wR·cos(St+Sw), …).

Method per shape: extract `<kind>` block, decode gdLst+pathLst at default adj
(w=h=100), compare to builder, classify MATCH / MINOR / BROKEN.

136 builders audited (8 parallel agents). bentArrow already fixed separately.

## BROKEN — wrong orientation / topology / missing major feature

### Wave 1 — pure geometry (single Path2D, high confidence) — DONE ✅
- [x] **bentArrow** — pointed down + no rounded bend → head-right + concentric arc bend
- [x] **decagon** — was rotated 90°; now points left/right (rotation 0).
- [x] **dodecagon** — was rotated 30°; now flat edges flush all 4 cardinals (r=½/cos15°, rot 15°).
- [x] **plaque** — straight chamfers → concave quarter-circle `arc` at all 4 corners.
- [x] **foldedCorner** — folded NE → folds **bottom-right (SE)** dog-ear; handle on bottom edge.
- [x] **halfFrame** — square-cut tips → mitred tips (`x2=r−dx2`, `y2=b−dy2`); thickness from `ss`.
- [x] **round2DiagRect** — rounded NE+SW → **NW+SE** (adj2 default 0).
- [x] **snipRoundRect** — rounded SW → rounds **NW** (NE snip kept).
- [x] **teardrop** — straight-up V → curved tip to **upper-right 45°**; handle on top edge.

All 9 verified via `test/.../shapes/**` (real-canvas `isPointInPath`); registry snapshot
regenerated (only these 9 keys changed); `slides test` green (2274), no new typecheck errors.

### Wave 3 — needs fold/curl lines or structural redesign (confirm fidelity vs single-fill convention)
Note: codebase convention is single-fill + internal edge lines (cube/can do this, no shading). Match within that convention.
- [ ] **ellipseRibbon / ellipseRibbon2** — arch direction inverted; fold tab placement wrong.
- [ ] **leftRightRibbon** — missing central vertical fold (renders as plain L-R arrow).
- [ ] **ribbon / ribbon2** — flat; missing swallowtail folds + fold-shadow tabs.
- [ ] **horizontalScroll / verticalScroll** — plain corner circles; OOXML has scroll curls + inner spiral hole.
- [ ] **bevel** — hollow frame; OOXML = filled inner rect + 4 bevel faces.
- [ ] **borderCallout1/2/3** — 70–75% rect + filled wedge; OOXML = full-frame rect + unfilled leader **line** (1/3/4 points). (Possible intentional design — confirm.)

## MINOR — correct orientation/topology, proportion or adjustment-semantics drift

### Wave 2 — proportion / adjustment fidelity
- [ ] **plus** — adj is edge-inset (arm = 50% at default), builder treats adj as arm thickness (25%).
- [ ] **blockArc** — inner radius multiplicative (1−adj3) vs OOXML constant offset `ss·adj3`.
- [ ] **corner / halfFrame** — thickness scales by w/h instead of `ss=min(w,h)`.
- [ ] **snip1Rect** (12500 vs 16667), **snip2DiagRect** (both vs NE-only default), **snip2SameRect / round2SameRect** (adj1/adj2 = top/bottom pair semantics; defaults).
- [ ] **chevron** — adj as fraction of h/2 rescaled, not `ss·adj` direct (shallower default).
- [ ] **stripedRightArrow** — stripe boundaries by /5 not ss/32-based.
- [ ] **leftArrow/rightArrow/upArrow/downArrow/leftRightArrow** — head length by w/h not ss; straight head base (no dx1 notch).
- [ ] **bentUpArrow** — 2 adj vs OOXML 3 (independent head width); head tied to shaft.
- [ ] **upDownArrow** — 2 adj, hardcoded shaftHalf ratio.
- [ ] **rightArrowCallout + left/up/down + leftRight + upDown + quad callouts** — arrowhead not flared (head==shaft at default); OOXML head half=`ss·a2`, shaft half=`ss·a1/2`.
- [ ] **flowChartDelay** — cap radius `min(h/2,w)` vs OOXML `w/2`.
- [ ] **flowChartDocument / Multidocument** — symmetric sine bottom vs OOXML asymmetric bezier.
- [ ] **flowChartManualInput** (top inset h/4 vs h/5), **flowChartManualOperation** (taper .125 vs .2).
- [ ] **flowChartMagneticTape** — foot triangle vs OOXML circle-trim corner.
- [ ] **flowChartPunchedCard** (cut .25 vs .2 per-axis), **flowChartPunchedTape** (amp), **flowChartTerminator** (elliptical caps vs pill).
- [ ] **sun** — connected star, missing central disc + discrete rays.
- [ ] **lightningBolt** — 7-vertex flat top vs OOXML 11-vertex pointed apex.
- [ ] **heart / smileyFace** — polyline-approx curves (acceptable; low priority).
- [ ] **mathPlus/Minus/Equal** — bars full-width vs 73.49%; **mathMultiply** (45° vs at2 corners); **mathDivide** (dot radius/gap swapped); **mathNotEqual** (adj3 = angle not thickness).
- [ ] **wedgeRoundRectCallout** — tail only when downward; **cloudCallout** — 2 bubbles vs 3, stop short of tip.

## MATCH (verified faithful)
rect, ellipse, roundRect, triangle, rtTriangle, diamond, parallelogram, trapezoid,
pentagon, hexagon, heptagon, octagon, pie, chord, arc, frame, diagStripe, round1Rect,
notchedRightArrow, pentagonArrow, swooshArrow, quadArrow, leftRightUpArrow, uturnArrow,
curvedRight/Left/Up/DownArrow, circularArrow, flowChartCollate/Connector/Display/Extract/
InternalStorage/Merge/MagneticDisk/MagneticDrum/Offpage/OnlineStorage/Or/PredefinedProcess/
Preparation/Sort/SummingJunction, cube, can, donut, noSmoking, star4–32, irregularSeal1/2,
moon, cloud, leftBrace, rightBrace, leftBracket, rightBracket, bracePair, bracketPair,
wave, doubleWave, wedgeRectCallout, wedgeEllipseCallout.

## Review
(to fill in)
