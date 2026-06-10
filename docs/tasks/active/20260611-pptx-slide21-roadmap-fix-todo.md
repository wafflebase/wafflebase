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

- [ ] `packages/slides/src/model/connection-site.ts` — add the four
      diagonal `DIR_NE`, `DIR_SE`, `DIR_SW`, `DIR_NW` constants.
- [ ] `packages/slides/src/view/canvas/connection-sites/overrides.ts`
      — add `ELLIPSE_SITES` with 8 entries in **PPTX `cxnLst` order**
      (CCW from top: N, NW, W, SW, S, SE, E, NE) so the importer
      stores `idx` directly without a per-shape remap table.
      Register under `ShapeKind` "ellipse". Document the site
      coordinates (x=0.5±cos(45°)/2, y=0.5∓sin(45°)/2 = 0.1464 / 0.8536)
      with a reference to the OOXML preset.
- [ ] `packages/slides/src/import/pptx/shape.ts` — make
      `ooxmlToWaffleSiteIndex` shape-aware. Lookup table keyed by
      target shape kind. For ellipse / oval, return idx verbatim. For
      rect-family, keep the existing `[0,3,2,1]` remap. Other shapes
      (triangle, n-gons) still pass through with the rect remap as a
      noted limitation — out of scope for this PR.
- [ ] `packages/slides/test/import/pptx/connector.test.ts` — add a
      regression test that builds an `<p:sp prstGeom prst="ellipse">`
      target and connectors with `endCxn id idx="0"..."7"`, asserts the
      stored `siteIndex` equals the input idx, and that the world-space
      position of each site (via `siteWorldPos`) matches the expected
      cardinal/diagonal point on the ellipse bbox.

## P2 — `<a:lumMod>` / `<a:lumOff>` modifier parsing + resolution

`lumMod` (luminance modulation, 0..100000 thousandths) and `lumOff`
(luminance offset, -100000..100000 thousandths) are HSL-space
adjustments to a theme color. PowerPoint applies them after the role
lookup but before tint/shade in the resolution order (per ECMA-376
§ 20.1.2.3 color modifier semantics).

- [ ] `packages/slides/src/model/theme.ts` — extend the `role` variant
      of `ThemeColor` with optional `lumMod?: number` and `lumOff
      ?: number` (raw OOXML thousandths, matching the existing
      tint/shade import convention). `applyLumModOff(hex, lumMod,
      lumOff)` helper that converts hex → HSL, multiplies L by
      `lumMod/100000`, adds `lumOff/100000`, clamps to [0,1], converts
      back. `resolveColor` applies lumMod/lumOff before tint/shade.
- [ ] `packages/slides/src/import/pptx/color.ts` — read `<a:lumMod>`
      and `<a:lumOff>` children in `applyModifiers`, store on the
      result like tint/shade.
- [ ] `packages/slides/test/import/pptx/color.test.ts` — assert that
      `<a:schemeClr val="bg1"><a:lumMod val="95000"/></a:schemeClr>`
      stores `{ role: 'background', lumMod: 95000 }`, and a
      lumMod+lumOff pair is captured together.
- [ ] `packages/slides/test/model/theme.test.ts` — assert that
      resolving `{ role: 'background', lumMod: 95000 }` against a
      `bg1=#FFFFFF` theme yields the expected near-white hex (≈
      `#F2F2F2` at 95% luminance), and that `{ role: 'background',
      lumMod: 75000 }` yields a clearly visible mid-gray. Edge cases:
      clamp at 0 / 100% L, lumOff alone, lumMod+lumOff combined.

## Verification

- [ ] `pnpm verify:fast` green (slides unit tests + lint).
- [ ] Manual: import the user-reported PPTX (private), open slide 21,
      confirm the green 8월 arrow terminates at the LEFT edge of the
      circle and that both gray circles are visible.

## Out of scope

- **Triangle / rtTriangle / n-gon shape-aware remap.** Same root
  pattern as Issue 1 but no user report yet. Captured as a follow-up
  in `shape.ts` once the per-shape table lands.
- **Existing tint/shade raw-value bug.** The importer stores
  `tint: 50000` (raw OOXML thousandths) but `resolveColor` treats the
  value as a `0..1` ratio in `tintColor` / `shadeColor`, which
  saturates to white/black for any real tint. Separately tracked;
  this PR does not change tint/shade behavior to avoid scope creep.
- **`<p:embeddedFontLst>` and other unrelated PPTX gaps.** See the
  existing `20260610-pptx-korean-font-fallback-todo.md` for the
  font-side roadmap.
