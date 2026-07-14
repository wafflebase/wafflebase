---
title: shared-core-extraction
target-version: 0.6.0
---

<!-- Make sure to append document link in design README.md after creating the document. -->

# Shared Core Extraction

## Summary

The three editor engines — `@wafflebase/sheets`, `@wafflebase/docs`,
`@wafflebase/slides` — independently re-implement several concerns that are
not engine-specific: OOXML file-format plumbing (ZIP/XML/relationships/units),
DrawingML sub-format parsing, geometry primitives, and Canvas setup
boilerplate. `@wafflebase/tokens` already proves the shared-leaf pattern works
(palette/typography consumed by all three), and `slides → docs` already proves
clean cross-engine reuse (the rich-text engine). This doc audits which further
modules are genuine extraction candidates and proposes a phased rollout that
extends the shared-package layer without collapsing engine-specific logic.

### Goals

- Eliminate real triplication (same code in xlsx/docx/pptx paths) and ad-hoc
  duplication (geometry types redefined even within a single package).
- Promote the mature single-owner OOXML/DrawingML implementation (currently
  slides-only) to a shared home that docs and sheets can consume.
- Preserve the leaf character of `@wafflebase/tokens` (pure constants, no
  engine logic) by adding sibling shared packages rather than overloading it.
- Keep each engine's format-specific document-model logic (~75%+ of the
  import/export code) in its own package.

Success = a new shared package (or two) exists, the three engines depend on it,
the flagged duplication (the `rels` comment, geometry redefinitions, canvas DPR
boilerplate) is deleted from the engines, and `pnpm verify:self` stays green.

### Non-Goals

- **Chart unification.** Sheets chart (Recharts/DOM + live cell ranges) and
  slides chart (Canvas painter + frozen `numCache` snapshot) share *concept*,
  not *code*. There is nothing to extract today; convergence is a downstream
  consequence of OOXML extraction, not part of this work (see below).
- **Color/theme model unification.** `ThemeColor` (slides), `StoredColor`
  (docs), light/dark `Theme` (sheets) are structurally parallel but
  semantically divergent — a large refactor with low ROI. Deferred.
- **Store abstraction unification.** `Store`/`DocStore`/`SlidesStore` are three
  independent interfaces bound to their own model types. No common base
  proposed here.
- **Fill/gradient picker extraction** (frontend UI). Slides-only today; extract
  only when docs/sheets actually need gradient fills.

## Proposal Details

### Current shared-vs-duplicated map (audit result)

Dependency graph today (`@wafflebase/*`, all at 0.5.1):

```
tokens (leaf)  ← sheets, docs, slides, frontend
docs           ← slides         (rich-text engine reuse; ~22 import sites)
sheets/docs/slides ← frontend, backend, cli
```

**Already shared, healthy — do not touch:**

- `@wafflebase/tokens` — `palette`/`typography`/`radius`/`contrast`. Consumed
  by sheets/docs/slides + frontend CSS. (design-system-unification.md PR#1.)
- **Rich-text engine** — docs owns `computeLayout`/`paintLayout`/
  `initializeTextBox`/`CanvasTextMeasurer` + `Block`/`Inline` model; slides
  reuses via `@wafflebase/docs`. **This is the extraction pattern to emulate.**
- **Frontend cross-cutting UI** — comments, `@mentions`, fonts + font picker,
  text-formatting components, presence/avatars, shadcn `ui/` primitives — all
  already shared inside `packages/frontend/src/components/`.

**Extraction candidates, tiered by readiness × value:**

| Candidate | State today | Tier | Notes |
| --- | --- | --- | --- |
| OOXML plumbing (ZIP, XML facade, `.rels`, EMU units, XML escaping) | Triplicated across xlsx/docx/pptx | **A** | ~1,000–1,300 LOC. `packages/slides/src/import/pptx/rels.ts` comment already flags it: *"Same shape as docs's `parseRelationships`, kept separate so slides doesn't depend on docs internals."* |
| DrawingML sub-format (color/fill/gradient, `<a:xfrm>`, effects, `theme1.xml`) | slides-only (237 refs; docs 2, sheets 0) | **A** | ~700–800 LOC single-source. Genuinely a shared OOXML sub-format; docs (images/shapes) and sheets (charts/shapes) can newly consume it. |
| Geometry (`Point`/`Rect`/`Size`/bbox/hit-test) | Pure duplication; redefined even *within* slides | **A** | Small, mechanical, high hygiene. See redefinition sites below. |
| Canvas helpers (DPR/2d-ctx setup, `roundRect` fallback, offscreen) | Copy-pasted across all 3 view layers | **B** | Boilerplate `ctx.scale(dpr,dpr)` etc. Small. |
| Color/theme model (`ThemeColor`/`resolveColor`) | 3 independent systems | **C** | Parallel but divergent. Deferred (Non-Goal). |
| Store abstraction | 3 independent interfaces | **C** | Deferred (Non-Goal). |
| Fill/gradient picker (frontend) | slides-only | **D** | Extract on demand. |
| Chart | sheets=Recharts/DOM, slides=Canvas painter | **D** | Convergence target, not an extraction (see below). |

Geometry redefinition sites (Tier A, illustrative):
`packages/slides/src/model/frame.ts`,
`packages/slides/src/view/canvas/routing.ts`,
`packages/slides/src/view/editor/interactions/insert.ts`,
`packages/slides/src/view/editor/interactions/lasso.ts`,
`packages/slides/src/model/image-crop.ts`,
`packages/sheets/src/view/layout.ts` (`Size` with `width/height` vs slides
`w/h` — a real field-name mismatch across packages).

### Why chart is a Non-Goal (and how it converges later)

The two chart modules are opposite by design:

- **Sheets** — `SheetChart` points at a live `sourceRange` (A1); rendered with
  Recharts as a DOM/SVG overlay. Data is recomputed from cells.
- **Slides** — `ChartElement` self-contains frozen `numCache`/`strCache` values
  (slides have no backing workbook); rendered by a Canvas-native painter so PDF
  export is free.

Sharing chart code would require first defining a common chart-spec type *and*
migrating sheets onto a Canvas painter — out of scope. The productive path is
indirect: once **DrawingML is extracted**, slides' chart color/theme resolution
consumes the shared module, and when sheets adds xlsx chart import it reuses the
same DrawingML + theme parsing. Chart unification then becomes a natural
follow-up on top of the OOXML core, not a prerequisite.

### Proposed package layout

Decision: **one shared package `@wafflebase/core`, internally modularized via
subpath exports** — and the existing `@wafflebase/tokens` is **folded into it**
as the `./tokens` subpath rather than kept as a separate leaf. Net result: the
whole shared foundation is a **single** package (down from tokens + a planned
core), which is the "too many packages" concern resolved directly.

```
packages/core/
  package.json            # exports map splits the subpaths
  scripts/build-css.ts    → generates dist/tokens.css (moved from tokens)
  src/
    tokens/               → @wafflebase/core/tokens     (palette, semantic, radius, typography, contrast)
      index.ts palette.ts semantic.ts radius.ts typography.ts contrast.ts
    geometry/index.ts     → @wafflebase/core/geometry     (Point/Rect/Size, bbox, hit-test)
    canvas/index.ts       → @wafflebase/core/canvas        (DPR ctx setup, drawRoundedRect, offscreen)
    ooxml/
      index.ts            → @wafflebase/core/ooxml         (zip · xml · rels · units · escape)
      zip.ts xml.ts rels.ts units.ts escape.ts
      drawingml/index.ts  → @wafflebase/core/ooxml/drawingml  (color · xfrm · effects · theme)
```

```jsonc
// package.json exports
"exports": {
  "./tokens":          { "types": "...", "import": "./dist/tokens/index.js",         "require": "./dist/cjs/tokens/index.js" },
  "./tokens.css":      "./dist/tokens.css",
  "./geometry":        { "types": "...", "import": "./dist/geometry/index.js",       "require": "./dist/cjs/geometry/index.js" },
  "./canvas":          { "types": "...", "import": "./dist/canvas/index.js",         "require": "./dist/cjs/canvas/index.js" },
  "./ooxml":           { "types": "...", "import": "./dist/ooxml/index.js",          "require": "./dist/cjs/ooxml/index.js" },
  "./ooxml/drawingml": { "types": "...", "import": "./dist/ooxml/drawingml/index.js","require": "./dist/cjs/ooxml/drawingml/index.js" }
}
```

Build/tsconfig mirror the former `tokens` build (plain `tsc` dual ESM/CJS to
`dist`, plus a `tsx` build step that generates the CSS token bundle — no Vite
lib bundling; this is pure logic + a CSS artifact). `jszip` is a dependency of
`core` but is only reachable through the `./ooxml` entry, so a module importing
`@wafflebase/core/geometry` or `@wafflebase/core/tokens` does not pull it into
the bundle (subpath entry + tree-shaking). No root `.` barrel — subpath imports
keep bundles tight and keep the jszip weight isolated.

Resulting graph (one leaf for the whole foundation):

```
core (leaf: tokens + geometry + canvas + ooxml; jszip)   ← sheets, docs, slides ← frontend/backend/cli
docs ← slides   (rich-text, unchanged)
```

Node/CommonJS consumers (backend jest via ts-jest) don't honour `exports`
subpaths under classic resolution, so `packages/backend/tsconfig.json` maps
`@wafflebase/core/*` → `../core/src/*` (source), alongside the existing
sheets/docs/slides source paths.

Alternatives considered:
- **Keep `tokens` a separate leaf next to `core`** — the original plan; the user
  chose to consolidate to a single foundation package. `./tokens` as a subpath
  keeps the CSS-artifact concern isolated behind its own export, so the earlier
  "mixes CSS with logic" objection no longer applies.
- **Two sibling packages (`core` + `ooxml`)** — cleaner dependency isolation on
  paper, but more packages; the jszip-weight concern it solved is already handled
  by subpath exports + tree-shaking. Rejected for package-count simplicity.

### Rollout — Tier A in one package, three shippable PRs

All three phases land in the single `@wafflebase/core` package. The migration is
still split by PR because slides is the largest OOXML/DrawingML consumer, so
regression risk is staged.

1. **PR1 / Phase 0 — `@wafflebase/core` bootstrap + `geometry` + `canvas`
   (low risk).** Scaffold the package (mirror `tokens` build), add the
   `geometry` and `canvas` subpath modules, migrate all three engines off their
   local redefinitions (slides `frame`/`routing`/`insert`/`lasso`/`image-crop`
   modules, sheets `layout` `Size`). Also fix the misclassified `tokens` dep
   (below). Proves package wiring with the lowest-risk content.
2. **PR2 / Phase 1 — `core/ooxml` plumbing (Tier A).** Add ZIP/XML/rels/units/
   escaping under `./ooxml`. Promote slides' `PptxArchive`/`PptxWriter`/`xml`/
   `rels` as canonical; migrate docx + xlsx import/export to consume them.
   Delete the flagged `rels`/`parseRelationships`/`parseWorkbookRelationships`
   triplication.
3. **PR3 / Phase 2 — `core/ooxml/drawingml` (Tier A).** Move slides'
   `color`/`geometry`(`parseXfrm`)/`effects`/`theme` OOXML modules + export
   inverses under `./ooxml/drawingml`. Guard against render regressions with the
   existing slides import/export/round-trip/painter suite. docs/sheets opt in
   incrementally (docs images/shapes; sheets charts later).
4. **Phase 3+ (deferred)** — chart convergence, color/theme model, store base:
   only after the OOXML core is stable.

### Incidental fix

`packages/docs/package.json` lists `@wafflebase/tokens` under
**devDependencies**, but `packages/docs/src/view/theme.ts` imports `palette`
at runtime. Promote to a regular dependency (fold into Phase 0).

### Risks and Mitigation

- **slides is the primary consumer of the extracted OOXML/DrawingML** — a
  regression there is high-blast-radius. *Mitigation:* extract by promoting
  slides' own code as the canonical source (behavior-preserving move, not
  rewrite); lean on the existing slides import/export/round-trip/painter test
  suites as the regression gate before each merge.
- **docs uses namespace-URI XML traversal; slides/sheets use `localName`.**
  Consolidating on the `localName` facade requires adapting docs' parser.
  *Mitigation:* keep docs on its parser in Phase 1 if needed and migrate as a
  scoped follow-up; the shared facade must cover both strategies or docs adopts
  `localName` deliberately with its own tests.
- **Version/publish coupling** — more workspace packages to keep in lockstep at
  0.x. *Mitigation:* all `@wafflebase/*` already move together at one version;
  new packages follow the same release cadence.
- **Over-extraction** — pulling divergent color/theme/store into "core" would
  create a leaky abstraction. *Mitigation:* explicit Non-Goals; Tier C/D stay
  out until a concrete second consumer exists.
- **Churn vs. value on Tier B/D** — small helpers may not justify a package
  boundary. *Mitigation:* geometry + canvas ride together in `core`; picker/
  chart wait for demand.
