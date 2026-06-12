# PPTX slide 21 roadmap diagram fix

A user reported that slide 21 (a "smart clip roadmap" diagram with three
month/year nodes connected by horizontal arrows) imports incorrectly
from a private deck (`최상위영입채널_유튜브비교_260608_vF.pptx`):

1. The arrow that should terminate at the **left edge** of the "8월"
   green circle terminates at the **bottom** instead.
2. The "11월" and "27년" gray circles are completely invisible.

Both are root causes in `packages/slides/src/import/pptx/`, not in
rendering. Two orthogonal defects ship in the same branch because they
affect the same slide:

- **Issue 1** — `import/pptx/shape.ts` applies the rect-family OOXML
  `cxnLst → waffle FOUR_CARDINAL` index remap `[T,L,B,R] → [N,E,S,W]`
  to every shape including ellipses, which use a different (8-point
  CCW-from-top) connection-site numbering. PPTX's `idx=2` (W/left on an
  ellipse) gets mapped to Waffle's S/bottom, so the arrow attaches to
  the wrong side. Held-back per the existing TODO in `shape.ts:746-763`.
- **Issue 2** — `import/pptx/color.ts` `applyModifiers` reads
  `<a:tint>`, `<a:shade>`, and `<a:alpha>` but ignores `<a:lumMod>` and
  `<a:lumOff>`. The 11월 / 27년 circles use `<a:schemeClr val="bg1">
  <a:lumMod val="95000"/></a:schemeClr>` for fill and `lumMod val
  ="75000"` for the border. Both modifiers are dropped, so both fill
  and border render as pure white (`bg1`), making the circles
  invisible on a white slide background.

## P1 — Ellipse N-direction connection sites + shape-aware OOXML remap

Adds the full 8-cardinal+diagonal site set for `ShapeKind` "ellipse"
and replaces the global rect-family remap with a per-shape lookup.
Native authoring picks up the new sites for free (the picker, snap,
and hit-test paths iterate `sites.length`).

- [x] `packages/slides/src/model/connection-site.ts` — added the four
      diagonal `DIR_NE`, `DIR_SE`, `DIR_SW`, `DIR_NW` constants.
- [x] `packages/slides/src/view/canvas/connection-sites/overrides.ts`
      — `ELLIPSE_SITES` with 8 entries in PPTX cxnLst order (CCW
      from top: N, NW, W, SW, S, SE, E, NE). Site coords
      `(0.5 ± SQRT1_2/2 ≈ 0.1464 / 0.8536)`. Registered under
      `ShapeKind` "ellipse".
- [x] `packages/slides/src/import/pptx/shape.ts` — `ooxmlToWaffleSite
      Index` is now shape-aware. Identity remap for ellipse; rect
      remap for everything else. Target shape kind plumbed via a new
      `shapeKindByPptxId` field on `SlideParseContext`, filled in
      `preassignIds` from `<a:prstGeom prst>`.
- [x] `packages/slides/test/import/pptx/connector.test.ts` — `prst`
      param on `buildTree` helper; new tests assert (1) ellipse idx
      0..7 stored verbatim and (2) idx=2 lands on the W cardinal
      site at (0, 0.5) for the slide-21 case.

## P2 — `<a:lumMod>` / `<a:lumOff>` modifier parsing + resolution

(Also normalizes the existing `<a:tint>` / `<a:shade>` parsing on the
same code path so all four color modifiers store 0..1 ratios at the
import boundary. Pre-fix the importer stored tint / shade as raw
OOXML thousandths but `tintColor` / `shadeColor` expected 0..1, so
any PPTX tint / shade saturated to white / black.)

`lumMod` (luminance modulation, 0..100000 thousandths) and `lumOff`
(luminance offset, -100000..100000 thousandths) are HSL-space
adjustments to a theme color. PowerPoint applies them after the role
lookup but before tint/shade in the resolution order (per ECMA-376
§ 20.1.2.3 color modifier semantics).

- [x] `packages/slides/src/model/theme.ts` — extended the `role`
      variant of `ThemeColor` with optional `lumMod?: number` and
      `lumOff?: number`, stored as **0..1 ratios** (importer
      normalizes from OOXML thousandths at the import boundary, so
      `resolveColor` doesn't re-scale every paint). `applyLumModOff
      (hex, lumMod, lumOff)` converts hex → HSL, applies `L ← clamp
      (L * lumMod + lumOff, 0, 1)`, converts back. `resolveColor`
      applies lumMod/lumOff before tint/shade (per ECMA-376).
- [x] `packages/slides/src/import/pptx/color.ts` — `applyModifiers`
      now reads `<a:lumMod>` and `<a:lumOff>` children, divides by
      100000 at parse time, stores 0..1 ratios.
- [x] `packages/slides/test/import/pptx/color.test.ts` — asserts
      `<a:schemeClr val="bg1"><a:lumMod val="95000"/></a:schemeClr>`
      stores `{ role: 'background', lumMod: 0.95 }`; lumMod+lumOff
      pair captured together as 0.75 / 0.25.
- [x] `packages/slides/test/model/theme.test.ts` — bg1=#FFFFFF +
      lumMod 0.95 → `#F2F2F2`; lumMod 0.75 → `#BFBFBF`. lumOff alone
      on text=#000000 → mid-gray. Combined lumMod + lumOff on
      accent1 round-trips to original. Clamp tests at L≥1 and L≤0.

## Verification

- [x] `pnpm verify:fast` green (slides 1727 / 1729 — 5 new lumMod +
      ellipse tests; docs 925 / 926; sheets 1279 / 1279; frontend
      531 / 575; cli 191 / 191; backend 175 / 175). EXIT=0.
- [x] Manual: import the user-reported PPTX (private), open slide 21,
      confirm the green 8월 arrow terminates at the LEFT edge of the
      circle and that both gray circles are visible. Confirmed by
      user; landed in `a5a27471`.

## Out of scope

- **Triangle / rtTriangle / n-gon shape-aware remap.** Same root
  pattern as Issue 1 but no user report yet. Captured as a follow-up
  in `shape.ts` once the per-shape table lands.
- **`<p:embeddedFontLst>` and other unrelated PPTX gaps.** See the
  existing `20260610-pptx-korean-font-fallback-todo.md` for the
  font-side roadmap.
