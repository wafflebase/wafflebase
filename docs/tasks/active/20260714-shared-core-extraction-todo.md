# Shared Core Extraction — Tier A

Design: [`docs/design/shared-core-extraction.md`](../../design/shared-core-extraction.md)

Extract engine-level duplication (geometry, canvas helpers, OOXML plumbing,
DrawingML) into a single new `@wafflebase/core` package with subpath exports.
Tier A only; chart / color-model / store deferred as Non-Goals.

Package layout: one package, subpaths `./geometry`, `./canvas`, `./ooxml`,
`./ooxml/drawingml`. Build mirrors `@wafflebase/tokens` (tsc dual ESM/CJS).

## PR1 / Phase 0 — bootstrap + geometry + canvas (low risk)

**Convention decision:** shared geometry adopts slides' `{ x, y, w, h }` /
`{ w, h }` convention (slides has the most usage + worst duplication). `Frame`-
bound helpers (`toLocal`/`boundingBox`/`framesApproxEqual`/`frameCorners`) stay
in `slides/model/frame.ts` — they depend on the slides `Frame` model, not pure
geometry. Only pure type aliases + pure rect helpers move to core.

**Sheets `Size` deferred, not migrated:** sheets uses `{ left, top, width,
height }` (a CSS-rect convention, `BoundingRect = Position & Size`). Forcing it
into `w/h` would be a leaky abstraction; leave sheets as-is this phase.

- [x] Scaffold `packages/core/` (package.json, tsconfig{,.build,.build.cjs}, vitest) mirroring tokens
- [x] `src/geometry/index.ts` — `Point`, `Size`, `Rect` + pure helpers (`normalizeRect`, `rectContainsPoint`, `rectsIntersect`, `unionRect`, `rectCenter`)
- [x] Unit tests for geometry
- [x] Migrate slides off local geometry redefinitions: `model/frame.ts` (`Point`), `view/canvas/routing.ts` (`Point`), `view/editor/interactions/insert.ts` (`Point`/`Size`), `view/editor/interactions/lasso.ts` (`Rect`+`normalizeRect`+`rectsIntersect`), `model/image-crop.ts` (`Rect`); `Frame` helpers stay in `model/frame.ts`, re-export shared `Point`
- [x] Fix `packages/docs/package.json` — move `@wafflebase/tokens` devDep → dependency (runtime import in `src/view/theme.ts`)
- [x] Add `@wafflebase/core: workspace:*` dep to slides
- [x] **Fold `@wafflebase/tokens` into `@wafflebase/core`** (user request): move src/scripts/tests → `core/src/tokens` + `core/scripts/build-css.ts`, add `./tokens` + `./tokens.css` exports + CSS build step; rewire all consumers (frontend CSS+JS, sheets/docs/slides theme.ts, deps), backend jest mapping + `tsconfig` `@wafflebase/core/*` path, root `pnpm tokens build`→`pnpm core build` (+ verify-self/browser-lanes/ci.yml/knip); delete `packages/tokens`
- [ ] `src/canvas/index.ts` — DPR-aware 2d context setup, `drawRoundedRect`, offscreen creation + tests + migrate the three view layers (deferred — boilerplate varies per call site; assess separately)
- [ ] `pnpm verify:fast` green; open PR1

**Checkpoint before consumer migration** — package + geometry + tests land
first (zero risk to existing code); pause for review before touching
slides/sheets/docs consumers.

## PR2 / Phase 1 — core/ooxml plumbing

- [ ] `src/ooxml/zip.ts` — promote slides `PptxArchive`/`PptxWriter` (jszip wrapper)
- [ ] `src/ooxml/xml.ts` — `localName`-based parse + traversal facade (cover docs' namespace-URI needs)
- [ ] `src/ooxml/rels.ts` — `parseRels` + `resolveRelsTarget` (supersedes 3 copies)
- [ ] `src/ooxml/units.ts` — EMU/twips/point conversions
- [ ] `src/ooxml/escape.ts` — XML text/attr escaping
- [ ] Migrate slides pptx import/export to `core/ooxml`
- [ ] Migrate docx import/export (adapt docs XML traversal)
- [ ] Migrate xlsx import to `core/ooxml`
- [ ] Delete `slides/.../rels.ts`, docs `parseRelationships`, sheets `parseWorkbookRelationships` triplication
- [ ] `pnpm verify:self` green; open PR2

## PR3 / Phase 2 — core/ooxml/drawingml

- [ ] `src/ooxml/drawingml/color.ts` — solidFill/gradFill/srgbClr/schemeClr + modifiers + inverse
- [ ] `src/ooxml/drawingml/geometry.ts` — `parseXfrm`, EMU/rot helpers
- [ ] `src/ooxml/drawingml/effects.ts` — outerShdw/reflection + image adjustments
- [ ] `src/ooxml/drawingml/theme.ts` — theme1.xml clrScheme/fontScheme
- [ ] Migrate slides to consume `core/ooxml/drawingml` (regression gate: slides import/export/round-trip/painter suite)
- [ ] `pnpm verify:full` green; open PR3

## Review

_(fill in per PR)_

## Notes / open questions

- XML parser: slides/sheets use `localName` traversal; docs uses namespace-URI.
  Shared facade must cover both, or docs adopts `localName` deliberately (own tests).
- slides is the largest OOXML/DrawingML consumer → each migration is
  behavior-preserving move (not rewrite), gated by existing slides tests.
