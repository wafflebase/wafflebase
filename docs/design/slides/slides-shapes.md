---
title: slides-shapes
target-version: 0.7.0
---

# Slides Shape Library

## Summary

The `@wafflebase/slides` package ships an OOXML-aligned shape library:
**55 `ShapeKind` values** rendered through a single path-builder
registry, with per-shape adjustments stored as
`data.adjustments?: number[]` and edited via yellow-diamond drag
handles on the canvas. The library targets ~100-shape Google Slides
parity, with naming chosen to map 1:1 onto OOXML `prstGeom` presets
for forward-compatible PPTX import.

This document covers the architectural contract — data model,
renderer dispatch, adjustments abstraction, picker UX, OOXML alignment
— and references a brief phase roadmap. Per-phase implementation
plans (catalogs, test strategy, file layouts, baselines) live as
task docs under `docs/tasks/`.

## Goals

- One shared rendering contract across all shapes: each closed-path
  shape is a pure `(size, adjustments) => Path2D` function, the
  dispatcher applies fill / stroke / theme color resolution. Only
  `line` and `arrow` are special-cased (open path + arrowhead).
- One storage contract for parametric shapes: `data.adjustments`
  mirrors OOXML `<a:avLst><a:gd>` so per-shape parameters round-trip
  to PPTX without an extra encoding layer.
- One editing contract for adjustments: a single
  `AdjustmentHandle` abstraction backs yellow-diamond drag handles
  across four axis types (radial, linear, point, multi-axis).
- Naming aligned to OOXML preset names (`roundRect`, `chevron`,
  `flowChartDocument`, `wedgeRectCallout`, …) so the future PPTX
  importer is a `prst → ShapeKind` table lookup, not a per-shape
  translation layer.
- Additive growth: adding a new shape registers one entry in each
  of three maps (`PATH_BUILDERS`, optionally `ADJUSTMENT_SPECS`,
  optionally `ADJUSTMENT_HANDLES`) — no dispatcher edits, no schema
  migration.

## Non-Goals

- **Connector behaviour.** `line` and `arrow` are free-floating;
  elbow / curved connectors that snap between two source elements
  are a separate workstream.
- **Shape-internal text.** Text inside a shape continues to be a
  separate `TextElement` overlapping the shape, as today.
- **Path-precise hit-testing.** Selection still uses the rotated
  frame AABB. Click-through-the-hole-of-donut behaviour using
  `ctx.isPointInPath(path, x, y)` is a follow-up.
- **Number-input UI for adjustments.** Drag handles are the
  canonical UX (matches Google Slides). A typed-value popover is
  recorded as a possible follow-up but is not required.
- **Multi-selection adjustment.** Drag handles only show on
  single-selection — there is no defined "what does dragging mean
  across heterogeneous shapes" semantic in any reference product.

## Proposal Details

### Data model

`packages/slides/src/model/element.ts`:

```ts
export type ShapeKind =
  // Lines (open-path, arrowhead) — special-cased renderers
  | 'line' | 'arrow'
  // Basic shapes (15) — rect, roundRect, ellipse, triangle, …
  // Block arrows (8) — rightArrow, …, chevron, pentagonArrow
  // Callouts (4) — wedgeRectCallout, …, cloudCallout
  // Equation (6) — mathPlus, …, mathNotEqual
  // Stars (6) — star4, …, star10
  // Flowchart (14) — flowChartTerminator, …, flowChartDisplay
  | …;

export type ShapeElement = ElementBase & {
  type: 'shape';
  data: {
    kind: ShapeKind;
    /**
     * OOXML-aligned per-shape adjustments (mirrors <a:avLst><a:gd>).
     * Path builders read this with sensible defaults when missing.
     * Units are per-shape — typically OOXML "thousandths" (25000 =
     * 25% of the relevant dimension); see each builder's
     * `*_ADJUSTMENTS` constant for the exact interpretation.
     */
    adjustments?: number[];
    fill?: ThemeColor;
    stroke?: ShapeStroke;
  };
};
```

`adjustments` is optional from day one. When absent or shorter than a
builder expects, each builder falls through to its declared
`AdjustmentSpec.defaultValue`. This means newly-added shapes never
require a Yorkie schema migration — existing documents keep
rendering with defaults, and the first user-driven drag populates
the array.

#### `math*` vs `plus` disambiguation

OOXML has both `plus` (a thick `+` block) and `mathPlus` (a thin
arithmetic glyph). We ship both as separate kinds; the future
importer disambiguates by inspecting host context. Wafflebase-
authored decks always pick the unambiguous kind from the picker.

#### No `'preset'` escape hatch yet

The full OOXML catalog has ~187 `prstGeom` presets. The remaining
~130 are deferred behind a DrawingML formula evaluator (P4); when
it lands, `ShapeKind` will gain a `'preset'` variant with
`data.presetName: string`. We don't reserve the slot up front
because an unused field would expose noise in the live schema.

### Renderer architecture

```
packages/slides/src/view/canvas/
├── shape-renderer.ts          # dispatcher
├── shape-special.ts           # drawLine, drawArrow (open-path + arrowhead)
└── shapes/
    ├── builder.ts             # PathBuilder, AdjustmentSpec, AdjustmentHandle,
    │                          # adj() helper, regularPolygonPath()
    ├── index.ts               # PATH_BUILDERS, ADJUSTMENT_SPECS,
    │                          # ADJUSTMENT_HANDLES — three Map registries
    ├── basic/                 # 15 closed-path builders
    ├── arrows/                # 8 block-arrow builders
    ├── callouts/              # 4 callout builders
    ├── equation/              # 6 math-glyph builders
    ├── stars/                 # 6 N-pointed-star builders
    └── flowchart/             # 14 flowchart-shape builders
```

The dispatcher in `shape-renderer.ts`:

```ts
export function drawShape(ctx, size, data, theme) {
  if (data.kind === 'line') return drawLine(ctx, size, data, theme);
  if (data.kind === 'arrow') return drawArrow(ctx, size, data, theme);

  const builder = PATH_BUILDERS.get(data.kind);
  if (!builder) return drawPlaceholderRect(ctx, size, data, theme);

  const path = builder(size, data.adjustments);
  if (data.fill) {
    ctx.fillStyle = resolveColor(data.fill, theme);
    ctx.fill(path);
  }
  if (data.stroke) {
    ctx.strokeStyle = resolveColor(data.stroke.color, theme);
    ctx.lineWidth = data.stroke.width;
    ctx.stroke(path);
  }
}
```

Each path builder is pure geometry:

```ts
export type PathBuilder = (
  size: { w: number; h: number },
  adjustments?: number[],
) => Path2D;
```

Builders never touch `fillStyle` / `strokeStyle` — that is the
dispatcher's job. This split keeps every shape file under ~30 lines,
trivially unit-testable via `ctx.isPointInPath`, and lets the
picker reuse the same builders to render its icon previews.

The unknown-kind fallback (`drawPlaceholderRect`) is a forward-
compatibility shim for future kinds whose builder isn't registered
yet — partial registration during development never crashes a
slide.

### Adjustments model

Three orthogonal contracts, each backed by its own registry:

| Registry | Purpose | Required for shape? |
|---|---|---|
| `PATH_BUILDERS` | geometry | yes |
| `ADJUSTMENT_SPECS` | adjustable parameter metadata (name, default, min, max, optional formatter) | only if parametric |
| `ADJUSTMENT_HANDLES` | drag-handle position + inverse-apply | only if interactively editable |

A shape can have specs without handles (its parameter is stored and
honoured but not yet draggable — e.g. `donut` until its handle
ships), and the reverse cannot happen — a registry-consistency test
asserts every `ADJUSTMENT_HANDLES` key has a matching `ADJUSTMENT_SPECS`
entry, and both keys exist in `PATH_BUILDERS`.

#### `AdjustmentSpec` — storage contract

```ts
export type AdjustmentSpec = {
  name: string;             // human-readable, e.g. "Corner radius"
  defaultValue: number;     // canonical OOXML default
  min: number;
  max: number;
  format?: (value: number) => string;  // e.g. "50%" for the drag tooltip
};
```

Each parametric shape exports a `*_ADJUSTMENTS: readonly AdjustmentSpec[]`
constant. Defaults follow ECMA-376 Part 1 §20.1.9 preset definitions
where one exists; otherwise the value is picked to match
PowerPoint's visual default.

#### `AdjustmentHandle` — editing contract

```ts
export type AdjustmentHandle = {
  position: (frame: FrameSize, adjustments: number[]) => Point;
  apply: (
    frame: FrameSize,
    startAdjustments: number[],
    pointer: Point,
  ) => number[];
};
```

Both functions work in **element-local coords** (origin = frame
top-left, axes = pre-rotation). The editor applies the rotation
transform once at paint and inverse-rotates once at hit-test, so
shapes never have to know about rotation.

`apply` returns the **full** adjustments array, not a delta. This
matters for point-axis handles (e.g. callout tail) where one drag
writes two indices, and for shapes with cross-coupled parameters.
Indices the handle does not control are passed through from
`startAdjustments` unchanged. Each value is clamped to its
`AdjustmentSpec`'s `min..max`.

Pointer is **absolute**, not delta. Radial inverses need distance
from centre, linear inverses need absolute projection, point-axis
needs absolute coordinates — none of them naturally consumes a
delta.

#### Four axis types

The pilot set of nine drag-handle shapes covers all four types:

| Axis | Examples | `apply` math |
|---|---|---|
| Radial | 6 stars | project pointer onto handle-ray in unit-ellipse space |
| Linear (corner) | `roundRect` | clamp `pointer.x` to `[0, min(w,h)/2]` |
| Linear (edge) | `chevron` | clamp `pointer.x` to `[0, w]`, invert path-builder's inset formula |
| Point (2D) | `wedgeRectCallout` | independent x / y signed fraction of frame, clamped per index |

Adding a new parametric shape to the editable set is one new file
exporting `*_HANDLES: readonly AdjustmentHandle[]` plus one
`.set()` call in `shapes/index.ts`. No core changes.

#### Drag interaction

The editor's `startAdjustmentDrag` mirrors the existing
`startResize` path:

1. `pointerdown` on a yellow-diamond hits the handle (8px square
   hit area against an 8px visual diamond; adjustment handles are
   in the DOM overlay above resize handles).
2. `pointermove` invokes `handle.apply(frame, startAdjustments, localPointer)`,
   live-paints the new geometry, and updates a tooltip
   (`AdjustmentSpec.format(value)` — defaults to `"x: 75.0% / y: 100.0%"`
   for point-axis).
3. `pointerup` commits a single `store.batch` that writes
   `data.adjustments = live`.
4. Pre-threshold drags (< 2px movement) commit nothing.

Concurrent edits are last-write-wins, same as `frame` resize and
`fill` changes — `adjustments` is a JSON array inside the element's
`data` object, not OT-aware. Per-index OT could be added later if
the use-case ever justifies it.

#### Handle / resize collision

If a parametric shape's handle position lands on top of a resize
handle (e.g. `roundRect` at `r = 0` would paint the corner-radius
handle on the NW resize corner), the `position` function applies
an 8px element-local **inset guard** so the diamond never paints
closer than 8px to a frame corner. The underlying data still
reaches the boundary value — only the diamond's draw position is
clamped.

### Picker UI

The frontend toolbar exposes one **Shape ▾** button
(`packages/frontend/src/app/slides/slides-formatting-toolbar.tsx`)
that opens a Radix `Popover`:

- ~280 px wide, scrollable.
- Sections in fixed order: **Lines · Shapes · Block Arrows ·
  Flowchart · Callouts · Equation · Stars**. Mirrors Google Slides'
  picker order.
- Each section is a 6-column grid of 32 × 32 px buttons with
  24 × 24 px previews.
- Previews render through the same `PATH_BUILDERS` — a
  `renderShapeIcon(kind, ctx, size)` helper paints an outline at
  `2 × DPR` in `currentColor`. New shapes appear automatically; no
  SVG icon assets to maintain.
- Clicking calls `editor.setInsertMode(kind)`; the next pointer
  drag on the slide creates that shape (existing `dragAdd` flow
  in `insert.ts`).

`SHAPE_PICKER_CATEGORIES` (in `shape-picker-helpers.ts`) is the
source of truth for which kinds appear in which section with which
labels. An invariant test (`shape-picker.test.ts`) asserts every
category entry has a registered `PATH_BUILDERS` builder.

`InsertKind` (in `editor.ts`) is `ShapeKind | 'text'`. The
`buildInsertElement` dispatcher in `insert.ts` looks up a per-kind
`STYLE_BY_KIND` style (`'filled' | 'outlined' | 'lineSpecial'`)
for the initial fill / stroke. The five P1 conventions:

| Category | Default fill | Default stroke |
|---|---|---|
| Lines | (none) | `role: 'text'`, width 2 |
| Basic / Block Arrows / Equation / Stars | `role: 'accent1'` | (none, except stars: `role: 'text'`, width 1) |
| Callouts / Flowchart | `role: 'background'` | `role: 'text'`, width 2 |

### OOXML alignment

Every `ShapeKind` name matches an OOXML `prstGeom` preset value,
**except** the equation prefix `math*` (disambiguating the basic
`plus` block from the equation `+` glyph — see Data model §`math*`).
A few OOXML aliases map onto an existing kind rather than getting
their own entry:

| OOXML preset | Maps to | Reason |
|---|---|---|
| `flowChartProcess` | `rect` | identical geometry |
| `flowChartAlternateProcess` | `roundRect` | identical geometry |
| `flowChartDecision` | `diamond` | identical geometry |
| `flowChartData` | `parallelogram` | identical geometry |

The importer (when shipped — tracked under
`slides-themes-layouts-import.md`) maps these aliases through its
`prst → ShapeKind` table. Adjustment-array indices and ranges
match OOXML units (typically thousandths) so
`<a:avLst><a:gd fmla="val 25000"/>` round-trips through
`data.adjustments[i] = 25000` without conversion.

### Phase roadmap

The library is delivered incrementally:

| Phase | Cumulative shapes | Adds | Adjustments UX |
|---|---|---|---|
| P1 — Foundation | 35 | 2 lines + 15 basic + 8 block arrows + 4 callouts + 6 equation | defaults only |
| P2 — Practical | 55 | + 14 flowchart + 6 stars | defaults only |
| P3-A.1 — Pilot handles | 55 | (no new shapes) | drag handles for 9 pilot shapes (4 axis types) |
| P3-A.2 — Sweep | 55 | (no new shapes) | drag handles for remaining 24 parametric shapes |
| P3-B — GS parity | ~105 | + extra callouts/arrows/banners + 12 action buttons | handles ship with shape |
| P4 — OOXML full | 187 | remaining presets via DrawingML formula evaluator | (no new UX) |

Each phase is tracked as a task pair in `docs/tasks/` (search
`slides-shapes` in the archive index). Architectural decisions
locked at P1 — adjustment storage shape, builder signature, picker
model, OOXML-aligned naming — propagate through every later
phase without doc churn.

## Risks and Mitigation

### Geometry degenerates at small frames

Some shapes (donut, callouts, plus) produce ill-formed paths at
very small frames or extreme aspect ratios — a 5 × 5 px donut has
hole > outer, a 1 × 100 frame collapses a `flowChartDocument`
wave to sub-pixel amplitude.

**Mitigation**: each builder clamps adjustment-derived parameters
to a per-shape invariant (e.g. `r ≤ min(w, h) / 2` for round-rect
corners, amplitude `≤ min(h/8, w/16)` for waveforms). The
selection-handle minimum (30 × 30 px) prevents users from
authoring frames in the worst regime.

### Path2D shim limitations in tests

Some JSDOM canvas implementations have incomplete `Path2D` support
(notably `quadraticCurveTo`). Multi-period wave shapes use polyline
approximation rather than quadratic Bézier specifically to stay
within shim coverage.

**Mitigation**: `test-canvas-env.ts` pins a canvas version; the
registry-snapshot test exercises every builder. If a primitive
fails, the builder falls back to manual `lineTo` polylines without
changing the `PathBuilder` signature.

### Picker icon legibility at 24 px

Densely-pointed shapes (`star10`) can compress visually into a
near-circle outline at picker size, defeating the icon's purpose.

**Mitigation**: render previews at `2 × DPR` with 1.5 px stroke;
contrast measured during baseline regen. If a particular kind
reads as ambiguous, the picker can override that kind's preview
stroke locally without touching the canvas-render path.

### Concurrent adjustment drags are last-write-wins

Two users dragging the same shape's `adjustments[0]` simultaneously
both see live local paint; on `pointerup`, the second commit
silently overwrites the first.

**Mitigation**: this matches the existing `frame` resize and
`fill` model. Per-index OT would be additive and is out of scope —
adjustments are infrequent edits with small blast radius.

### Handle / resize-handle collision

A parametric handle whose position lands on a resize handle
becomes unhittable.

**Mitigation**: `position` functions apply an 8 px inset guard
near edges and corners — the diamond never paints closer than
8 px to a resize handle. Data still reaches the boundary value;
only draw position is clamped. Adjustment handles are appended
**after** resize handles in the DOM overlay so they win hit
priority where they do overlap.

## Out-of-scope follow-ups

| Phase | Item |
|---|---|
| P3-A.3 | Optional: typed number-input popover fallback for users who prefer keyboard entry. Reads / writes the same `data.adjustments`. |
| P3-C | Action-button click handlers in presentation mode (depends on P3-B). |
| P4 | DrawingML formula evaluator (`<a:avLst>` + guide formulas), enabling `kind: 'preset'` + `data.presetName` for unknown imports. |
| Importer | `prst → ShapeKind` mapping table for the PPTX importer (tracked under `slides-themes-layouts-import.md`). |
| Selection | Path-precise hit-testing via `ctx.isPointInPath`. Particularly relevant for stars (currently selects through the inner concave regions). |
| Connectors | Elbow / curved connectors that snap to two source elements — separate workstream from the static shape library. |
