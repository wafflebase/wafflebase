# PPTX connector site index L/R swap

## Problem

Imported PPTX deck "Yorkie, 캐즘 뛰어넘기.pptx" slide 24 renders MVC-diagram
connectors with their left/right endpoints flipped. The frame (bounding
box) is correct, but the resolved attachment points land on the wrong
side of the target shapes, so arrows that should hit a shape's left edge
hit its right edge and vice-versa.

## Root cause

PPTX/OOXML preset shapes `rect` and `roundRect` (which all four
mis-routed connectors anchor to in slide 24) declare their `cxnLst` in
order `T, L, B, R`:

| OOXML idx | position | angle    |
|-----------|----------|----------|
| 0         | Top      | `3cd4`   |
| 1         | **Left** | `cd2`    |
| 2         | Bottom   | `cd4`    |
| 3         | **Right**| `0`      |

Wafflebase's `FOUR_CARDINAL`
(`packages/slides/src/view/canvas/connection-sites/defaults.ts`) is in
order `N, E, S, W` — i.e. `T, R, B, L`. Indices 1 and 3 are swapped.

`parseCxnSp` in `packages/slides/src/import/pptx/shape.ts:515` passes
the raw PPTX `idx` through as `siteIndex` without remapping, so every
imported left/right anchor lands on the opposite edge.

## Plan

- [x] Reproduce + verify root cause from `slide24.xml`.
- [x] Add a unit test under `packages/slides/test/import/pptx/` for
      `parseCxnSp` that asserts PPTX `idx=1` maps to waffle siteIndex 3
      and PPTX `idx=3` maps to siteIndex 1 (top/bottom indices unchanged).
- [x] Watch it fail.
- [x] In `parseCxnSp` (`packages/slides/src/import/pptx/shape.ts`),
      remap the PPTX site index when constructing the `attached`
      endpoint. Limit the swap to indices 0–3 since current
      `getConnectionSites()` always returns `FOUR_CARDINAL` (4 sites).
- [x] Watch the test pass.
- [x] `pnpm verify:fast`.
- [ ] Commit on `fix/pptx-connector-site-index`, push, open PR.

## Review

Implemented as a small helper `ooxmlToWaffleSiteIndex(idx)` in
`packages/slides/src/import/pptx/shape.ts` that swaps idx 1 ↔ 3 and
passes everything else through unchanged; documented the OOXML/Waffle
ordering mismatch in a comment above the helper. Test coverage added
in `packages/slides/test/import/pptx/connector.test.ts` (four
connectors, all four indices). Lessons captured separately.

Side-note discovered en route: `packages/docs/dist/` was stale on
`main`, missing the `scale?` field that #256 added to
`TextBoxEditorOptions`. Rebuilt `@wafflebase/docs` locally to unblock
the slides typecheck. No source change needed.

## Out of scope

Per-ShapeKind connection-site overrides (slides-connectors PR2). When
those land, this static swap needs to become a per-shape OOXML→waffle
index map.
