---
title: slides-shapes
target-version: 0.4.1
---

# Slides Shape Library

## Summary

The `@wafflebase/slides` package ships an OOXML-aligned shape library:
**136 closed-path `ShapeKind` builders** rendered through a single
path-builder registry, plus a special-cased dispatcher for connectors
(`line` / `arrow`, now `ConnectorElement`), the 12 action buttons, and
the data-driven `freeform` (`<a:custGeom>` / scribble) kind. Per-shape
adjustments are stored as `data.adjustments?: number[]` and edited via
yellow-diamond drag handles on the canvas. The catalog now exceeds the
Google Slides shape menu (full PowerPoint Stars & Banners, the complete
flowchart set, double brackets) and a freehand scribble tool, with
naming chosen to map 1:1 onto OOXML `prstGeom` presets for
forward-compatible PPTX import.

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
  // Basic shapes (P1: 15, P3-B: +29) — rect, …, snipRoundRect
  // Block arrows (P1: 8, P3-B: +13) — rightArrow, …, swooshArrow
  // Banners (P3-B: 5) — ribbon, …, leftRightRibbon
  // Callouts (P1: 4, P3-B: +3 line callouts, P3-C: +7 arrow callouts) — wedgeRectCallout, …, quadArrowCallout
  // Brackets/braces (P3-C: 4) — leftBracket, rightBracket, leftBrace, rightBrace
  // Equation (6) — mathPlus, …, mathNotEqual
  // Stars (6) — star4, …, star10
  // Flowchart (14) — flowChartTerminator, …, flowChartDisplay
  // Action buttons (P3-B: 12) — special-cased renderer (body + glyph)
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
    /**
     * Optional inline text body painted on top of the fill/stroke.
     * Absent on freshly-inserted shapes. See `Shape text body` below.
     */
    text?: TextBody;
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

### Shape text body

Shapes can carry inline text directly via `data.text`, painted on
top of the fill/stroke. Matches PowerPoint and Google Slides where
every autoshape is a text container (double-click / Enter / type-
to-edit all enter text editing inside the shape).

```ts
// packages/slides/src/model/element.ts
export type TextBody = {
  blocks: Block[];
  autofit?: AutofitMode;
  verticalAnchor?: VerticalAnchorMode;
};
```

The same `TextBody` shape backs `TextElement.data` (via intersection
with `{ fill?, stroke? }`) so the docs text-box editor, the canvas
text renderer, and the autofit / vertical-anchor wiring all reuse
one structural type across both element kinds.

**Render order.** `shape-renderer.ts:drawShape` paints fill → stroke
→ `paintTextBody(ctx, size, data.text, theme, {padding, defaultVerticalAnchor})`
in that order, where `paintTextBody` is exported from
`text-renderer.ts` and shared with `drawText`. Shape callers pass
`SHAPE_TEXT_PADDING = { x: 14.4, y: 7.2 }` (PowerPoint's default
`<a:bodyPr lIns="91440" tIns="45720">` converted at the deck scale)
and `defaultVerticalAnchor: 'middle'`.

**Imported per-body insets.** When a PPTX `<a:bodyPr>` sets explicit
`lIns/tIns/rIns/bIns`, `import/pptx/text.ts:detectBodyInset` converts them
to deck px (per-axis `scale.sx/sy`, OOXML defaults filling absent sides)
and stores them on `TextBody.inset`. The renderer prefers this over its
default padding: shape callers thread it through `shapeTextInset(kind, w,
h, pad)` (composed with the preset text rect), and text-element callers
let `paintTextBody` fall back to `body.inset` (its native inset is
otherwise `0`). This is what keeps Google-Slides-style number-in-circle
labels — tiny `txBox="1"` boxes centered purely by large symmetric insets
— centered instead of pinned to the top-left corner. Absent ⇒ prior
per-kind default. The in-place editor stays consistent: `buildEditTarget`
threads the same inset into the edit frame (`shapeTextFrame(kind, frame,
inset)` for shapes, `insetFrame(frame, inset)` for text elements), so the
caret and glyphs land where the committed paint puts them.

**Editor entry.** Double-click and the type-to-edit / F2 / Enter
keyboard rules accept `el.type === 'shape'` in addition to
`'text'`. `enterEditMode` builds an `EditTarget` descriptor that
papers over the per-kind differences:

| | TextElement | ShapeElement |
| --- | --- | --- |
| blocks | `data.blocks` | `data.text?.blocks ?? [seed]` |
| edit frame | `element.frame` | element frame inset by `SHAPE_TEXT_PADDING` |
| autofit default | `'grow'` (frame tracks content) | `'none'` (frame is user-sized) |
| verticalAnchor default | `'top'` | `'middle'` |
| commit bridge | `store.withTextElement` | `store.withShapeText` |
| post-commit frame fit | yes (auto-grow) | no |

**Store API.** `SlidesStore.withShapeText(slideId, elementId, cb)`
mirrors `withTextElement` but reads/writes `data.text.blocks`. It
seeds an empty body on first entry and drops `data.text` again on
commit when the body ends up empty so freshly-inserted shapes never
accumulate empty `<p:txBody>` cruft on round-trips.

**PPTX mapping.** OOXML `<p:sp>` always pairs `<p:spPr>` (shape
props) with `<p:txBody>`; the importer folds `<p:txBody>` directly
into `ShapeElement.data.text`. Stand-alone text boxes (`txBox`
preset, no `prstGeom`) keep producing a `TextElement` — `txBox` is
OOXML's text-box-only preset and has no shape geometry. Pre-feature
imports of labelled shapes layered (`ShapeElement` + paired
`TextElement`); the new form is one element.

**v1 limitations.**
- *Type-to-edit first character.* The keystroke is consumed
  (`preventDefault`) and enters edit mode, but the first character is
  not yet inserted into the freshly-mounted text-box — the user has
  to type it again. Forwarding the initial character requires threading
  an `initialText` through `mountSlidesTextBox` into the docs editor;
  deferred as a follow-up.
- *Two import formats coexist in Yorkie storage.* Pre-feature decks
  imported a labelled shape as two layered elements (`ShapeElement`
  with no text + paired `TextElement` overlay); those documents keep
  rendering in the layered form indefinitely (no migration). Decks
  imported after this feature use the folded form (one `ShapeElement`
  with `data.text`). Visually the two differ only in the default
  inset and anchor — the folded form picks up the PowerPoint default
  inset (`SHAPE_TEXT_PADDING`) and `'middle'` anchor; the layered form
  uses whatever the paired TextElement was positioned at. Both render
  fine; future contributors editing this branch should be aware that
  the `parseSp` prstGeom branch and the legacy reader paths can both
  appear in a single workspace.

### Renderer architecture

```
packages/slides/src/view/canvas/
├── shape-renderer.ts          # dispatcher
├── shape-special.ts           # drawLine, drawArrow, drawActionButton
└── shapes/
    ├── builder.ts             # PathBuilder, AdjustmentSpec, AdjustmentHandle,
    │                          # adj() helper, regularPolygonPath()
    ├── curves.ts              # polylineArc / polylineEllipseArc — shared
    │                          # polyline approximation for every curved shape
    ├── handles.ts             # cross-family handle factories (incl. angular)
    ├── index.ts               # PATH_BUILDERS, ADJUSTMENT_SPECS,
    │                          # ADJUSTMENT_HANDLES — three Map registries
    ├── basic/                 # closed-path builders (P1: 15, P3-B: +29)
    ├── arrows/                # block-arrow builders (P1: 8, P3-B: +13)
    ├── banners/               # banner builders (P3-B: 5)
    ├── callouts/              # callout builders (P1: 4, P3-B: +3 line callouts)
    ├── equation/              # 6 math-glyph builders
    ├── stars/                 # 6 N-pointed-star builders
    ├── flowchart/             # 14 flowchart-shape builders
    └── action-buttons/        # 12 body + glyph pairs (P3-B)
```

The dispatcher in `shape-renderer.ts`:

```ts
export function drawShape(ctx, size, data, theme) {
  if (data.kind === 'line') return drawLine(ctx, size, data, theme);
  if (data.kind === 'arrow') return drawArrow(ctx, size, data, theme);
  if (isActionButton(data.kind)) {
    return drawActionButton(ctx, size, data, theme);
  }

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

`isActionButton(kind)` is a string-prefix check
(`kind.startsWith('actionButton')`). Action buttons are **not**
entered in `PATH_BUILDERS` — their geometry is body + inner glyph
(two distinct fills), which doesn't fit the
`(size, adj) => Path2D` contract every other shape uses.
`drawActionButton` paints in two passes: an outer bevel rectangle
with a 4 px inset (single fill), then a per-kind glyph path
(`role: 'text'` fill) scaled by `min(w, h)` so non-square frames
don't distort the icon. The 12 glyph builders live in
`shapes/action-buttons/<name>.ts` and aggregate into
`ACTION_BUTTON_GLYPHS: Map<ShapeKind, GlyphBuilder>` consumed by
the special renderer. Action buttons take no adjustments in V0 (every
OOXML preset has `<a:avLst/>` empty); presentation-mode click
semantics are a separate workstream (see Out-of-scope follow-ups).

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
honoured by the path builder, but not yet editable on the canvas —
typical when a new parametric shape lands ahead of its handle).
The reverse cannot happen: a registry-consistency test asserts every
`ADJUSTMENT_HANDLES` key has a matching `ADJUSTMENT_SPECS` entry, and
both keys exist in `PATH_BUILDERS`.

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

#### Five axis types

P3-A.1's pilot exercised four axes (radial, linear-corner,
linear-edge, point). P3-B adds **angular** for circular-arc
adjustments (`pie`, `arc`, `chord`, `blockArc`, `circularArrow`,
`uturnArrow`, `bentArrow`, `bentUpArrow`, and the four
`curved*Arrow` shapes). The five axes together cover every
parametric shape in the GS-parity catalog:

| Axis | Examples | `apply` math |
|---|---|---|
| Radial | 6 stars | project pointer onto handle-ray in unit-ellipse space |
| Linear (corner) | `roundRect` | clamp `pointer.x` to `[0, min(w,h)/2]` |
| Linear (edge) | `chevron` | clamp `pointer.x` to `[0, w]`, invert path-builder's inset formula |
| Point (2D) | `wedgeRectCallout` | independent x / y signed fraction of frame, clamped per index |
| Angular | `pie`, `arc`, `circularArrow` | `atan2(p − center)` → OOXML 60000ths (`60000 ⇒ 1°`), clamp; winding disambiguated against `startAdjustments` so dragging past 0°/360° doesn't snap |

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
  Banners · Flowchart · Callouts · Equation · Stars · Action
  Buttons**. Mirrors Google Slides' picker order, with Banners next
  to Block Arrows (visual affinity) and Action Buttons at the end
  (Google Slides exposes them via a separate Insert > Action button
  entry; the picker keeps them in one popover until P3-C splits
  them out).
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
for the initial fill / stroke. Conventions across all families:

| Category | Default fill | Default stroke |
|---|---|---|
| Lines | (none) | `role: 'text'`, width 2 |
| Basic / Block Arrows / Banners / Equation / Stars | `role: 'accent1'` | `role: 'text'`, width 1 |
| Callouts / Flowchart | `role: 'background'` | `role: 'text'`, width 2 |
| Action buttons | `role: 'background'` | `role: 'text'`, width 1 — `drawActionButton` reuses `stroke.color` for the inner glyph fill, falling back to the `background` role on collision so the glyph stays legible against any body fill |

### Drag-move

Dragging a selected element repositions it via a ghost preview rather
than live-mutating the element under the cursor. Hovering a selected
element's bbox shows a `move` cursor (mouse pointers only). During the
drag the original shape and its selection handles stay anchored in
place; a semi-transparent ghost copy (`GHOST_ALPHA`, the same constant
the insert-mode hover preview uses) follows the cursor. Selection
handles anchor to the original bbox; smart-guide / snap overlays anchor
to the ghost bbox.

Rendering reuses the renderer's existing ghost path:
`drawSlide` / `forceRender` accept `ghosts?: ReadonlyArray<Element>`
(generalized from a single `ghost?`), and each ghost is painted through
the normal `drawElement` path inside a `GHOST_ALPHA` alpha band — no
extra canvas layer and no synthesized slide. Connectors are excluded
from the `ghosts` array on this path: they keep rendering against their
original endpoints during the drag.

The move commits only on `pointerup`, inside a single `store.batch`:

- Non-connector elements commit through `updateElementFrame`
  (world delta → scope-local).
- Connectors commit through `commitTranslate` (free endpoints move,
  attached endpoints stay put).
- A zero-delta gesture (a click without drag) opens no batch.

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
| `homePlate` | `pentagonArrow` | historical synonym — same baseball-home-plate pentagon |

The importer (when shipped — tracked under
`slides-themes-layouts-import.md`) maps these aliases through its
`prst → ShapeKind` table. Adjustment-array indices and ranges
match OOXML units (typically thousandths) so
`<a:avLst><a:gd fmla="val 25000"/>` round-trips through
`data.adjustments[i] = 25000` without conversion.

### Callout geometry fidelity

The 14 callout builders are faithful ports of the ECMA-376
`presetShapeDefinitions.xml` `gdLst`/`pathLst` rather than freehand
approximations, so they read pixel-close to PowerPoint / Google Slides.
The shared OOXML guide operators (`pin`, `?:`, `cat2`/`sat2`, `mod`,
`arcTo`) live in `callouts/ooxml-math.ts` so each builder transcribes its
preset almost line-for-line.

- **Wedge callouts** (`wedgeRect`, `wedgeRoundRect`, `wedgeEllipse`) — the
  tail is a fixed third-of-side wide wedge anchored in the quadrant the
  tip points toward (`x1..x2` = `7..10` or `2..5` twelfths), with the exit
  edge chosen by the diagonal-slope test (`dz = |dy| − |dq|`,
  `dq = dxPos·h/w`). Shared in `callouts/wedge-common.ts`.
- **Border callouts** (`borderCallout1/2/3`) — a **full-frame filled box
  PLUS a separate `fill="none"` leader polyline** through 2/3/4 target
  points, carrying **4/6/8 `(y,x)` adjustments**. The leader is registered
  in `LEADER_BUILDERS` and stroked over the body by the renderer (a body
  with no fill still shows its border + leader). This replaced an earlier
  reduced-adjustment box+wedge approximation that broke PPTX import.
- **Arrow callouts** (`right/left/up/down/leftRight/upDown/quad`) — head
  depth is `ss·adj3/100000` (`ss = min(w,h)`), so heads stay shallow on
  non-square frames; `quadArrowCallout`'s central body is rectangular
  (`w`-based half-width, `h`-based half-height).
- **Cloud callout** — body reuses `basic/cloud.ts`; the three trailing
  bubbles use the OOXML radii (`ss·1800/1200/600 / 21600`) at the
  tip-anchored offsets along the tip → cloud-edge vector.

The shape-registry Path2D snapshot
(`test/view/canvas/shapes/registry.snap.test.ts`) locks these geometries;
per-builder `isPointInPath` tests cover the body + tail/leader/head.

### Phase roadmap

The library is delivered incrementally:

| Phase | Cumulative shapes | Adds | Adjustments UX | Status |
|---|---|---|---|---|
| P1 — Foundation | 35 | 2 lines + 15 basic + 8 block arrows + 4 callouts + 6 equation | defaults only | shipped |
| P2 — Practical | 55 | + 14 flowchart + 6 stars | defaults only | shipped |
| P3 — Handles + GS parity | 128 | + 22 basic + 7 snip/round rects + 13 block arrows + 5 banners + 3 line callouts + 12 action buttons + 7 arrow callouts + 4 brackets/braces; `homePlate` import alias | drag handles for all parametric shapes (4 axis types incl. `angular` for arc-based shapes) | shipped |
| P3.5 — PPT-parity catalog | 154 | + 2 explosions (`irregularSeal1/2`) + 2 waves (`wave`, `doubleWave`) + 2 curved ribbons (`ellipseRibbon/2`) + 4 high-point stars (`star12/16/24/32`) + 2 double brackets (`bracketPair`, `bracePair`) + 10 remaining flowchart shapes. Plain/accent line-callout variants deferred (duplicate geometry in the single-path model) | drag handles where parametric | shipped |
| P4 — OOXML full | 187 | remaining presets via DrawingML formula evaluator | (no new UX) | planned |
| P5 — Freeform drawing | — | promote import-only `freeform` to a user-authored Scribble tool (toolbar toggle → `startScribbleInsert` pointer-capture → normalized `FreeformPath`); click-vertex polyline + curve smoothing deferred | new insert interaction | shipped (scribble) |

Gap analysis vs PowerPoint / Google Slides (which presets these phases
close) is tracked in
`docs/tasks/active/20260620-slides-shape-gaps-todo.md`. The catalog is at
**Google Slides parity** today; P3.5/P5 close the PowerPoint-side
extensions (explosions, waves, high-point stars, double brackets, full
flowchart set) and the user-drawable freeform tool — the one reference-product
shape capability `freeform` currently covers for *import only*.

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
(notably `quadraticCurveTo`). Multi-period wave shapes and every
curved P3-B shape (`pie`, `arc`, `chord`, `blockArc`,
`circularArrow`, `uturnArrow`, `bentArrow`, `bentUpArrow`, the four
`curved*Arrow` shapes) use polyline approximation rather than
quadratic Bézier specifically to stay within shim coverage.

**Mitigation**: `test-canvas-env.ts` pins a canvas version; the
registry-snapshot test exercises every builder. P3-B routes all
new curves through one shared helper, `polylineArc` in
`shapes/curves.ts` (32-segment default, `DEFAULT_ARC_SEGMENTS`
constant), so a single code path covers both production and JSDOM.
If a primitive fails the builder falls back to manual `lineTo`
polylines without changing the `PathBuilder` signature.

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
| P3-C | Action-button click handlers in presentation mode (`data.action: { type: 'slide' \| 'url' \| 'sound', target: string }`), separate Insert > Action button menu entry. |
| Theming | Beveled fill gradients on action buttons (and the `bevel` shape). Path data unchanged; renderer reads a per-shape style hint. |
| P4 | DrawingML formula evaluator (`<a:avLst>` + guide formulas), enabling `kind: 'preset'` + `data.presetName` for unknown imports. |
| Importer | `prst → ShapeKind` mapping table for the PPTX importer (tracked under `slides-themes-layouts-import.md`). |
| Selection | Path-precise hit-testing via `ctx.isPointInPath`. Particularly relevant for stars (currently selects through the inner concave regions). |
| Connectors | Elbow / curved connectors that snap to two source elements — separate workstream from the static shape library. |
