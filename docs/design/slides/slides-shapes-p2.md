---
title: slides-shapes-p2
target-version: 0.6.0
---

# Slides Shape Library — Phase 2 (Practical)

## Summary

Phase 1 (`slides-shapes-p1.md`) shipped the shape-library foundation:
35 OOXML-aligned `ShapeKind` values, a path-builder registry, the
`Shape ▾` picker popover, and the `data.adjustments?: number[]` field
stored but not yet edited. Phase 2 reuses that foundation to add
**20 new shapes** — 14 flowchart presets and 6 stars — bringing the
cumulative catalog to **55 kinds** and adding two picker categories
(**Flowchart**, **Stars**).

This is a scope-revised P2: the original P1 roadmap row paired the
shape additions with a *toolbar number-input UI* for `adjustments`.
Google Slides' canonical UX is **yellow-diamond drag handles** on the
canvas, not numeric inputs in the toolbar. Adding a stop-gap toolbar
input now would teach users a non-standard pattern that the P3
drag-handle work would then have to replace. P2 therefore ships
shapes only; the adjustments UX is consolidated into P3 alongside
drag handles.

## Goals

- Extend `ShapeKind` from 35 to 55 kinds, adding 14 flowchart and 6
  star presets, all named after their OOXML `prstGeom` counterparts
  for forward-compatible importer mapping.
- Add a single shared geometry helper, `regularPolygonPath`, that
  computes inscribed-polygon vertices for stars and is back-applicable
  to the existing `pentagon` builder.
- Each new shape registers an `AdjustmentSpec` where OOXML defines
  one (e.g. star inner-ring ratio, document wave amplitude). Values
  are stored via `data.adjustments` defaults; **no editing UI** in
  P2.
- Extend the picker popover with two new sections — **Flowchart** and
  **Stars** — keeping the P1 DropdownMenu pattern, the canvas-rendered
  icon helper, and the existing keyboard / focus model.
- Ship without a Yorkie data migration — `ShapeKind` is a string
  union, the YorkieStore mirror in `packages/frontend/src/types/`
  picks up new values automatically.

### Success metric

After P2, the **Shape ▾** picker exposes 55 shapes across 7
categories. A user authoring a flowchart can compose all the common
boxes (terminator, decision via `diamond`, manual input/operation,
document, predefined process, …) without dropping to "draw a polygon"
fallbacks. Existing P1 documents render unchanged.

## Non-Goals

- **Adjustments editing UI.** Every shape uses its OOXML default. P3
  ships drag handles + a complementary number-input popover.
- **Shapes 56–187.** P3 fills the remaining Google-Slides-parity
  catalog (extra callouts, arrows, banners, action buttons); P4
  adds the DrawingML formula evaluator for the long tail.
- **OOXML aliases for existing geometry.** `flowChartProcess`,
  `flowChartAlternateProcess`, `flowChartDecision`,
  `flowChartData` paint identical geometry to `rect`, `roundRect`,
  `diamond`, `parallelogram` and are *not* added as separate
  `ShapeKind` values. The future PPTX importer will map those
  preset names onto the existing kinds via its preset table.
- **PPTX importer.** Still unimplemented, still tracked under
  `slides-themes-layouts-import.md`. P2 keeps the importer-friendly
  naming invariant.
- **Path-precise hit-testing, connector behavior, shape-internal
  text** — same exclusions as P1.

## Roadmap context (revised)

| Phase | Cumulative shapes | Adds | Adjustments UX | Picker categories |
|---|---|---|---|---|
| **P1 — Foundation** | 35 | 2 lines + 15 basic + 8 block arrows + 4 callouts + 6 equation | none (defaults only) | Lines · Shapes · Block Arrows · Callouts · Equation |
| **P2 — Practical** (this doc) | 55 | flowchart 14 + stars 6 | none (defaults only) | + Flowchart · Stars |
| **P3 — GS Parity** | 105 | extra callouts/arrows/banners + actionButtons 12 | drag handles (yellow diamonds) + popover number input | + Action Buttons |
| **P4 — OOXML Full** | 187 | remaining presets via DrawingML formula evaluator | (no new UX, all adjustments work) | (no new categories) |

The P1 row's "toolbar number inputs" cell moves into P3 ("drag
handles + popover number input"), grouping all adjustments UX into
one workstream where it can land coherently.

## Proposal Details

### 1. Catalog (20 new shapes)

Default fill / stroke conventions follow P1's table:

| Category | Default fill | Default stroke |
|---|---|---|
| Flowchart | `role: 'background'` | `role: 'text'`, width 2 |
| Stars | `role: 'accent1'` | `role: 'text'`, width 1 |

Flowchart shapes typically appear in diagrams alongside text labels
and connectors, so the white-filled / outlined default matches GS
behavior. Stars use the accent fill + thin text-coloured stroke
consistent with the basic-shape defaults — the implementation
simply slots them into the existing `'filled'` `STYLE_BY_KIND`
bucket rather than introducing a `'filledNoStroke'` variant.

#### Stars (6)

| # | Kind | OOXML `prst` | Adjustments (defaults in OOXML units) |
|---|---|---|---|
| 36 | `star4` | `star4` | `[12500]` (inner ratio, % × 1000) |
| 37 | `star5` | `star5` | `[19098]` |
| 38 | `star6` | `star6` | `[28868]` |
| 39 | `star7` | `star7` | `[34601]` |
| 40 | `star8` | `star8` | `[37500]` |
| 41 | `star10` | `star10` | `[42533]` |

Each star is N points × inner/outer alternation around an inscribed
ellipse (`rx = w/2`, `ry = h/2`). Star points are oriented apex-up
(rotation = `-π/2`). `star12 / star16 / star24 / star32` are
deferred to P3 — `star10` is the largest count where individual
points remain visually distinct at typical slide sizes.

The inner-ratio defaults in the table are the values quoted in
ECMA-376 Part 1 §20.1.9 (`star4 = §20.1.9.48`, `star5 = §20.1.9.49`,
…). The implementation task verifies them against the spec text and
against PowerPoint visual reference; if any default looks visibly
off (e.g. star points too thin or too thick vs PowerPoint's
preview), the value is corrected at implementation time and the
table here is updated in the same commit.

#### Flowchart (14)

Geometry-distinct OOXML flowchart presets only; the four aliases
(`flowChartProcess`, `flowChartAlternateProcess`, `flowChartDecision`,
`flowChartData`) reuse `rect / roundRect / diamond / parallelogram`
via importer mapping rather than adding redundant kinds.

| # | Kind | OOXML `prst` | Geometry | Adjustments |
|---|---|---|---|---|
| 42 | `flowChartTerminator` | `flowChartTerminator` | pill (full-radius semicircles on left/right) | — |
| 43 | `flowChartPredefinedProcess` | `flowChartPredefinedProcess` | rect with two vertical bars at `x = w/8` and `x = 7w/8` | — |
| 44 | `flowChartInternalStorage` | `flowChartInternalStorage` | rect with one horizontal bar at `y = h/8` and one vertical at `x = w/8` | — |
| 45 | `flowChartDocument` | `flowChartDocument` | rect with sinusoidal wavy bottom (1 period, amplitude `h/8`) | — |
| 46 | `flowChartMultidocument` | `flowChartMultidocument` | three stacked `flowChartDocument` silhouettes, offset `w/16, h/16` | — |
| 47 | `flowChartManualInput` | `flowChartManualInput` | quadrilateral with slanted top-left edge (top-left `y = h/4`) | — |
| 48 | `flowChartManualOperation` | `flowChartManualOperation` | inverted trapezoid (bottom-inset `25%`) | — |
| 49 | `flowChartOffpageConnector` | `flowChartOffpageConnector` | rect with V-cut bottom (cut depth `h/4`) | — |
| 50 | `flowChartPunchedCard` | `flowChartPunchedCard` | rect with top-left corner cut at `25% × 25%` | — |
| 51 | `flowChartPunchedTape` | `flowChartPunchedTape` | rect with sinusoidal top + bottom (1 period each, amplitude `h/8`) | — |
| 52 | `flowChartSummingJunction` | `flowChartSummingJunction` | ellipse + diagonal X across full bounds | — |
| 53 | `flowChartOr` | `flowChartOr` | ellipse + horizontal/vertical cross | — |
| 54 | `flowChartDelay` | `flowChartDelay` | left rect joined to right semicircle (D-shape) | — |
| 55 | `flowChartDisplay` | `flowChartDisplay` | rect with right-side rounded "screen" curve | — |

None of the P2 flowchart shapes register `AdjustmentSpec` entries —
the OOXML presets are non-parametric. (Wave amplitudes for
`Document` / `PunchedTape` are coded constants in the builder; an
adjustment slot is reserved as future work if needed.) The full set
of `ADJUSTMENT_SPECS` registrations is therefore: 6 new entries for
stars (inner-ratio), zero for flowchart.

### 2. Renderer architecture

#### Directory layout (additions)

```text
packages/slides/src/view/canvas/shapes/
├── builder.ts                 # adds regularPolygonPath helper
├── stars/
│   ├── star4.ts
│   ├── star5.ts
│   ├── star6.ts
│   ├── star7.ts
│   ├── star8.ts
│   └── star10.ts
└── flowchart/
    ├── terminator.ts
    ├── predefined-process.ts
    ├── internal-storage.ts
    ├── document.ts
    ├── multidocument.ts
    ├── manual-input.ts
    ├── manual-operation.ts
    ├── offpage-connector.ts
    ├── punched-card.ts
    ├── punched-tape.ts
    ├── summing-junction.ts
    ├── or.ts
    ├── delay.ts
    └── display.ts
```

`shapes/index.ts` adds 20 imports + `PATH_BUILDERS.set` calls + 6
`ADJUSTMENT_SPECS.set` calls. The dispatcher in `shape-renderer.ts`
needs no changes — every new kind goes through the existing path-
builder path. The unknown-kind placeholder fallback continues to be
exercised by a synthetic kind (P1 lessons §"Dispatcher invariants").

#### `regularPolygonPath` helper

Added to `shapes/builder.ts`:

```ts
/**
 * Vertices of a regular N-gon inscribed in an ellipse. Used by the
 * pentagon builder (P1) and star builders (P2). Returned in
 * polygon-walk order (no path object) so callers can interleave with
 * a second ring (stars) or close into a Path2D directly (pentagon).
 *
 * @param cx, cy  ellipse center
 * @param rx, ry  ellipse radii
 * @param points  vertex count (>= 3)
 * @param rotation  starting angle in radians; default `-Math.PI / 2`
 *                  (first vertex straight up)
 */
export function regularPolygonPath(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  points: number,
  rotation: number = -Math.PI / 2,
): { x: number; y: number }[];
```

Star builders compute two rings of vertices, outer at radii `(rx,
ry)` and inner at `(rx × ratio, ry × ratio)` where
`ratio = adjustments[0] / 100000`, then zigzag between them
(outer → inner → outer → …). The pentagon builder is refactored to
call `regularPolygonPath(cx, cy, rx, ry, 5)` instead of its current
hand-rolled trigonometry — pure geometry refactor, identical
output.

#### Wave drawing for `Document` / `PunchedTape`

Both shapes need a 1-period sinusoidal edge of amplitude `h/8`.
Implemented as 32-segment polyline approximation — same approach as
P1's `cloud` builder (canvas `Path2D` shim already supports
`lineTo` polylines reliably; `quadraticCurveTo` was avoided for
multi-period waves to keep the test shim happy, see P1 lessons
§"Test infrastructure"). Centralised in a small helper inside
`flowchart/document.ts`, which `multidocument.ts` and
`punched-tape.ts` import.

### 3. Picker UI

#### Section ordering

```text
Lines · Shapes · Block Arrows · Flowchart · Callouts · Equation · Stars
```

Mirrors Google Slides' picker order: flowchart sits adjacent to
"shapes" because flowchart elements are generally shape-like;
stars sit at the end as a decorative category.

#### Implementation

`packages/frontend/src/app/slides/shape-picker-helpers.ts` exports
`SHAPE_PICKER_CATEGORIES: readonly Category[]` where each category
is `{ id, title, kinds: { kind, label }[] }`. P2 inserts two new
entries (positions chosen per the section-ordering above):

```ts
// inserted between 'arrows' and 'callouts'
{
  id: 'flowchart',
  title: 'Flowchart',
  kinds: [
    { kind: 'flowChartTerminator',          label: 'Terminator' },
    { kind: 'flowChartPredefinedProcess',   label: 'Predefined process' },
    { kind: 'flowChartInternalStorage',     label: 'Internal storage' },
    { kind: 'flowChartDocument',            label: 'Document' },
    { kind: 'flowChartMultidocument',       label: 'Multi-document' },
    { kind: 'flowChartManualInput',         label: 'Manual input' },
    { kind: 'flowChartManualOperation',     label: 'Manual operation' },
    { kind: 'flowChartOffpageConnector',    label: 'Off-page connector' },
    { kind: 'flowChartPunchedCard',         label: 'Card' },
    { kind: 'flowChartPunchedTape',         label: 'Punched tape' },
    { kind: 'flowChartSummingJunction',     label: 'Summing junction' },
    { kind: 'flowChartOr',                  label: 'Or' },
    { kind: 'flowChartDelay',               label: 'Delay' },
    { kind: 'flowChartDisplay',             label: 'Display' },
  ],
},
// appended at the end (after 'equation')
{
  id: 'stars',
  title: 'Stars',
  kinds: [
    { kind: 'star4',  label: '4-point star' },
    { kind: 'star5',  label: '5-point star' },
    { kind: 'star6',  label: '6-point star' },
    { kind: 'star7',  label: '7-point star' },
    { kind: 'star8',  label: '8-point star' },
    { kind: 'star10', label: '10-point star' },
  ],
},
```

Each shape's picker icon is rendered through the existing
`renderShapeIcon` helper — no per-shape SVG asset needed. The 6-col
grid rounds up to 3 rows for Flowchart (`ceil(14/6) = 3`) and 1
row for Stars (`6/6 = 1`). The picker's invariant tests
(`shape-picker.test.ts`) auto-cover the new kinds — every
`SHAPE_PICKER_CATEGORIES` entry must have a registered
`PATH_BUILDERS` builder and a non-empty label.

#### `InsertKind` type

Currently the same union as `ShapeKind` plus `'text'`. Extends
automatically with the 20 new kinds. `buildInsertElement` in
`insert.ts` adds 20 cases, applying the category default fill /
stroke from §1.

### 4. Frontend Yorkie schema

`packages/frontend/src/types/slides-document.ts` declares
`YorkieShapeElement.data.kind: ShapeKind`, where `ShapeKind` is
*imported* from `@wafflebase/slides` (P1 lessons §"Test
infrastructure" referenced an inlined union, which a follow-up P1
commit migrated to a re-export). The 20 new kinds therefore flow
into the Yorkie type automatically when the slides package
publishes the expanded `ShapeKind`; no parallel edit is needed.

The lessons rule still applies for any *non-`ShapeKind`* element
field that gets added (e.g. a hypothetical `ShapeElement.data.foo`)
— the frontend `YorkieShapeElement.data` shape is hand-mirrored,
not imported wholesale, so structural changes do need a
synchronised edit.

### 5. Test strategy

- **Path builder unit tests**, one file per shape (`shapes/<file>.test.ts`):
  3–6 `isPointInPath` reference points (vertex inside, off-shape
  outside, hole-area outside where applicable). With the P1 shim
  approximation in mind, reference points sit ≥1 px inside the
  intended region.
- **`regularPolygonPath` unit test**: vertices for `points = 3, 4,
  5, 8` against analytic expectations (apex-up, equally spaced).
  Pentagon builder gets a snapshot-equivalence check pre/post
  refactor.
- **Registry snapshot test** (`shapes/registry.snap.test.ts`):
  auto-extends from 35 → 55 kinds. Verifies dispatcher resolves
  fill / stroke for one representative per category and falls back
  to placeholder rect for the synthetic unknown.
- **Picker UI test** (`packages/frontend/tests/app/slides/`): popover
  opens, all 55 shapes have a button with the correct aria-label, 7
  section headers in expected order, clicking sets insert mode, ESC
  closes.
- **Visual harness** (`packages/frontend/src/app/harness/visual/slides-scenarios.tsx`):
  the existing 35-shape catalog scenario expands to 55. If the
  resulting PNG exceeds the visual-gate budget (current 35-grid is
  ~30 KB; 55-grid extrapolates to ~50 KB, comfortably within
  budget), keep as one scenario; if it exceeds the per-scenario
  diff threshold during baseline regen, split into two scenarios:
  `shapes-catalog-basics` (35 P1 kinds) and `shapes-catalog-p2` (20
  P2 kinds).
  - **Baseline regeneration**: `pnpm verify:browser:docker:update`
    after the registry / picker work lands. Same workflow as P1.

### 6. Migration & backwards compatibility

- **Yorkie schema**: `ShapeKind` is a string union; new variants are
  additive. Existing documents (P1-authored) have no `data.adjustments`
  on the new kinds because they don't reference the new kinds. No
  migration runs. No version bump.
- **Renderer**: existing 35 shapes render bit-identical (pentagon
  refactor is geometry-equivalent; verified via shape-renderer
  snapshot test).
- **Picker**: existing 5 sections appear in the same order, in the
  same positions. New sections insert without disturbing P1
  category positions.

## Risks and Mitigation

### Risk: star points illegible at picker icon size

24 × 24 px stroked outlines of `star10` can compress visually into
a near-circle, defeating the icon's purpose.

**Mitigation**: render picker icons at `2 × DPR` (P1 already does
this), use 1.5 px stroke (P1 baseline), and measure star icon
contrast against `star4` and `star5` during baseline regen. If
`star10`'s icon reads as a circle at 24 × 24, increase its stroke
to 2 px in the picker only (canvas render stays at 1.5 px). No
data-model change.

### Risk: `flowChartPunchedTape` wave at extreme aspect ratios

A 1 × 100 frame collapses the wave amplitude to `h/8 = 0.125 px`,
producing a degenerate near-line. A 200 × 10 frame produces a
visibly truncated single-period wave that may not look like a
"tape".

**Mitigation**: builder clamps amplitude to `min(h / 8, w / 16)` so
extreme widths reduce wave height proportionally; very narrow
frames stay degenerate-but-well-formed. Selection minimum (30 × 30
px in P1) prevents users from authoring frames in the most
problematic regimes.

### Risk: pentagon refactor introduces a regression

Replacing the hand-rolled `pentagon` builder with the
`regularPolygonPath` helper changes the internal call path even if
the output is identical. Could subtly change vertex ordering or
floating-point output, breaking visual baselines.

**Mitigation**: the pentagon refactor commit is its own task with a
snapshot-equivalence test that pins pre-refactor coordinates. Visual
baseline regen for the pentagon scenario verifies pixel-level
equivalence. If output differs by a sub-pixel amount, accept the
new baseline as the canonical reference; if the difference is
visible, abandon the refactor commit and ship pentagon unchanged
(stars still get the helper).

### Risk: visual catalog scenario PNG too large

A 55-shape grid in one PNG might exceed the visual-gate file-size
or diff-threshold limits.

**Mitigation**: split into two scenarios on first baseline-regen
failure (described in §5). The split scenario IDs (`shapes-catalog-basics`,
`shapes-catalog-p2`) are decided up-front so the test plan
references them either way.

### Risk: scope creep into P3 work

The temptation to "just add a yellow drag handle for one of the
new stars" or "just hook up a number input for `star4`'s inner
ratio" is high once 6 stars with adjustments land in the catalog.

**Mitigation**: P3 is reserved for the unified adjustments UX
(drag handles + popover number input). Any toolbar-input or
canvas-handle PR opened during P2 review gets deferred. The
`adjustments` field, populated with OOXML defaults for all 6 new
stars, is the contract — P3 is purely additive on top.

## Out-of-scope follow-ups (recorded for later phases)

| Phase | Item |
|---|---|
| P3 | Drag-handle (yellow-diamond) editor for `adjustments`, including the 6 P2 stars; popover number-input fallback; +50 shapes for GS parity (extra callouts/arrows/banners + 12 action buttons); action button click handlers in presentation mode |
| P4 | DrawingML `prstGeom` formula evaluator (AVList + guide formulas); `kind: 'preset'` + `presetName: string` slot for unknown-preset import; replace hand-coded builders for shapes the engine handles; add adjustments to P2 flowchart shapes that benefit from them (Document / PunchedTape wave amplitude, OffpageConnector V-cut depth, ManualInput slant) |
| Importer | Map P2 kinds in `prst → ShapeKind` table; map flowchart aliases (`flowChartProcess` etc.) to existing P1 basic kinds |
| Selection | Path-precise hit-testing using `ctx.isPointInPath(path, x, y)` — particularly relevant for stars (currently selects through the inner concave regions) |
