# Fix `bentArrow` geometry (direction + rounded bend)

## Problem

Slide 17 of an imported PPTX has two `bentArrow` shapes that render with the
wrong direction and no rounded corner at the bend.

Original `slide17.xml`:

```xml
<!-- 589 --> <a:xfrm rot="10800000">          bentArrow adj1=25000 adj2=25000 adj3=25000 adj4=43750
<!-- 590 --> <a:xfrm flipH="1" rot="10800000"> bentArrow adj1=25000 adj2=25000 adj3=25000 adj4=43750
```

## Root cause

`packages/slides/src/view/canvas/shapes/arrows/bent-arrow.ts` (`buildBentArrow`)
is a simplified V0 that does not follow the OOXML `bentArrow` preset:

1. **Wrong base orientation** — it draws the arrowhead pointing **down**
   (horizontal top arm + vertical right arm). The OOXML preset points the
   arrowhead **right** (vertical tail on the bottom-left, rounded bend at the
   top-left, horizontal arm to the top-right). Our geometry is the canonical
   shape rotated 90° clockwise, so applying the file's `rot=180°` lands 90° off.
2. **No rounded bend** — only `adj1`/`adj2` are read and every corner is a sharp
   `lineTo`. OOXML `adj4` (=43750) is the bend radius; `adj3` the arrowhead
   length. The importer already parses all four adj values + rot/flip correctly,
   so the defect is entirely in the path builder.

## Plan

- [ ] Failing test: record `Path2D` calls, assert the tip points right + a
      rounded (arc) command exists. `bent-arrow.test.ts`.
- [ ] Rewrite `buildBentArrow` faithful to the ECMA-376 `bentArrow` pathLst:
      head-right orientation, two concentric arcs (outer `bd`, inner `bd2`)
      for the constant-thickness rounded bend, reading adj1..adj4.
- [ ] Expand `BENT_ARROW_ADJUSTMENTS` to 4 (shaft / arrowhead width / arrowhead
      length / bend radius) and `BENT_ARROW_HANDLES` to 4, matching OOXML `ahLst`.
- [ ] Fix the now-stale "mirror of bentArrow" comment in `bent-up-arrow.ts`
      (`bentUpArrow` already points up correctly — out of scope to change its geometry).
- [ ] `pnpm verify:fast` green.
- [ ] Manual smoke: re-import the deck, confirm slide 17 arrows.

## ECMA-376 reference (resolved gdLst)

```
ss=min(w,h); l=0 t=0 r=w b=h
a2=clamp(adj2,0,50000); maxAdj1=2*a2; a1=clamp(adj1,0,maxAdj1); a3=clamp(adj3,0,50000)
th=ss*a1/100000; aw2=ss*a2/100000; th2=th/2; dh2=aw2-th2; ah=ss*a3/100000
bw=r-ah; bh=b-dh2; bs=min(bw,bh); maxAdj4=100000*bs/ss; a4=clamp(adj4,0,maxAdj4)
bd=ss*a4/100000; bd2=max(bd-th,0); x3=th+bd2; x4=r-ah; y3=dh2+th; y4=y3+dh2; y5=dh2+bd
path: M(0,b) L(0,y5) arc(c=(bd,y5) r=bd 180°→270°) L(x4,dh2) L(x4,t) L(r,aw2 TIP)
      L(x4,y4) L(x4,y3) L(x3,y3) arc(c=(x3,y5) r=bd2 270°→180°) L(th,b) close
```

## Review

(to fill in)
