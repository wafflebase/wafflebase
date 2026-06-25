# Not Equal (mathNotEqual) — ECMA-376 geometry fidelity

## Context

User flagged two slide shapes:

1. **Bent Up Arrow** — user thought it should be rounded like Bent Arrow.
   Verified against ECMA-376 `presetShapeDefinitions.xml`: `bentUpArrow`
   is a 3-adjustment shape with a **sharp** corner (`moveTo` + 8×`lnTo` +
   `close`, no `arcTo`). Only `bentArrow` has the `adj4` bend-radius. Our
   `bent-up-arrow.ts` already matches ECMA exactly. **Decision: keep
   sharp, no change.**

2. **Not Equal (`mathNotEqual`)** — current code deviates from ECMA:
   - Adjustments are `[bar thickness, gap, slash thickness]` but ECMA is
     `[adj1 bar thickness, adj2 SLASH ANGLE, adj3 gap]`.
   - Slash angle hard-coded to 45°; ECMA makes it adjustable, default
     `6600000` (110° → ~70° from horizontal, steeper/more glyph-accurate).
   - Slash thickness is a separate thin value (6600); ECMA derives the
     slash weight from the bar thickness (`bhw = len·dy1/hd2`).

   **Decision: full ECMA reimplementation.**

## ECMA-376 `mathNotEqual` reference

```
avLst: adj1=23520, adj2=6600000, adj3=11760
gdLst (key):
  a1 = pin 0 adj1 50000
  crAng = pin 4200000 adj2 6600000
  maxAdj3 = 100000 - 2*a1 ; a3 = pin 0 adj3 maxAdj3
  dy1 = h*a1/100000              # bar thickness
  dy2 = h*a3/200000              # half-gap
  dx1 = w*73490/200000           # bars horizontal half-extent
  x1 = hc-dx1 ; x8 = hc+dx1
  y2 = vc-dy2 ; y3 = vc+dy2 ; y1 = y2-dy1 ; y4 = y3+dy1
  cadj2 = crAng - cd4(=5400000=90°)
  xadj2 = hd2*tan(cadj2) ; len = sqrt(xadj2²+hd2²)
  bhw = len*dy1/hd2 ; bhw2 = bhw/2
  x7 = hc+xadj2-bhw2
  x6=x7-xadj2*y1/hd2 ; x5=x7-xadj2*y2/hd2 ; x4=x7-xadj2*y3/hd2 ; x3=x7-xadj2*y4/hd2
  rx7=x7+bhw ; rx6/rx5/rx4/rx3 = x6/x5/x4/x3 + bhw
  dx7=dy1*hd2/len ; rxt=x7+dx7 ; lxt=rx7-dx7
  rx = cadj2>0 ? rxt : rx7 ; lx = cadj2>0 ? x7 : lxt
  dy3=dy1*xadj2/len ; dy4=-dy3
  ry = cadj2>0 ? dy3 : 0 ; ly = cadj2>0 ? 0 : dy4
  dlx=w-rx ; drx=w-lx ; dly=h-ry ; dry=h-ly
path (20 lnTo): x1,y1 → x6,y1 → lx,ly → rx,ry → rx6,y1 → x8,y1 → x8,y2 →
  rx5,y2 → rx4,y3 → x8,y3 → x8,y4 → rx3,y4 → drx,dry → dlx,dly → x3,y4 →
  x1,y4 → x1,y3 → x4,y3 → x5,y2 → x1,y2 → close
```

## Infra notes
- Adjustments stored as raw OOXML values; PPTX import (`parseAdjustments`)
  and export (`avLstXml`) pass them through verbatim, 1-based adjN ↔ 0-based array.
- Angle adjustments use raw 60000ths-of-degree; `angularHandle()` factory
  in `shapes/handles.ts` converts ↔ radians/pointer and clamps to spec min/max.
  Precedent: arc/pie/chord/blockArc.

## Plan / checklist
- [x] Rewrite tests first (TDD): glyph still valid; slash steeper than 45°;
      slash weight ≈ bar weight; angle adj round-trips; default adjustments
      match ECMA `[23520, 6600000, 11760]`.
- [x] Rewrite `MATH_NOT_EQUAL_ADJUSTMENTS` to `[bar thickness 0..50000,
      slash angle 4200000..6600000, gap 0..50000]` with ECMA defaults.
- [x] Port ECMA guides into `buildMathNotEqual` (verbatim formulas).
- [x] Rewrite `MATH_NOT_EQUAL_HANDLES`: bar-thickness diamond, slash-angle
      `angularHandle`, gap diamond (clamp gap to maxAdj3 from start adj1).
- [x] Update handle test for new model.
- [x] Slides tests + typecheck green (only the pre-existing `player.test.ts`
      `.at()` gate gap remains; no new errors).
- [x] Self code-review over branch diff (subagent: all 6 ECMA checks pass).
- [x] `slides-shapes.md` only lists notEqual in a category comment — no
      adjustment detail to update.

## Review

**Bent Up Arrow** — confirmed ECMA-faithful sharp corner; no code change.

**Not Equal** — full ECMA-376 geometry port. Key correctness points vs the
prior reverted attempt (`bfb231ab`):
- `x7 = hc + xadj2 − bhw2` (prior bug used `+ bhw2`, shifting the slash off
  the bars → the "broken diagonal" that got reverted).
- Adjustment order fixed to ECMA `[bar thickness, slash ANGLE, gap]` (prior
  kept `[bar, gap, angle]`, so PPTX import stayed mis-mapped).
- Slash weight derived from bar thickness (`bhw = len·dy1/hd2`); the separate
  thin "slash thickness" adjustment is removed.
- Slash angle is now adjustable via the shared `angularHandle` (raw 60000ths),
  default 110° (≈70° from horizontal).

ASCII rasterization at 110°/90°/70° confirmed a clean, non-self-intersecting
`≠` at every angle. Registry snapshot regenerated; diff confirmed **only**
the `mathNotEqual` key changed. PPTX import/export pass raw adjustment values
through verbatim, so the new `[bar, angle, gap]` order now round-trips
correctly against PowerPoint/Google Slides files.
