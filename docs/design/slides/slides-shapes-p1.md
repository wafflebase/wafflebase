---
title: slides-shapes-p1
target-version: 0.5.0
---

# Slides Shape Library — Phase 1 (Foundation)

## Summary

The `@wafflebase/slides` package currently exposes four shape kinds —
`rect`, `ellipse`, `line`, `arrow` — versus ~100 in Google Slides and
~187 OOXML `prstGeom` presets in PowerPoint (ECMA-376 Part 1). The gap
hurts both in-app authoring (users reach for shapes that do not exist)
and PPTX import fidelity (any non-rect/ellipse/line preset becomes a
placeholder rectangle, see `slides-themes-layouts-import.md`).

This document specifies **Phase 1 of a four-phase roadmap** that closes
the gap. Phase 1 is the *foundation*: it lands the data model,
renderer architecture, picker UI, and the first 35 shapes (Google
Slides "most-used" subset; 33 new path-builders on top of the
existing `line` / `arrow` specials). Phases 2–4 reuse the foundation
to expand to 55, 105, and finally the full OOXML 187.

## Goals

- Extend `ShapeKind` from 4 to 35 kinds, with naming aligned to OOXML
  preset names (`roundRect`, `triangle`, `pentagonArrow`,
  `wedgeRectCallout`, …) so the importer (when shipped) is a 1:1 map.
- Introduce a `ShapeElement.data.adjustments?: number[]` field that
  mirrors OOXML `<a:avLst>` so per-shape parameters (corner radius,
  star points, callout tail position, …) have a forward-compatible
  storage from day one.
- Replace the current per-shape `switch` in `shape-renderer.ts` with a
  **path-builder registry**: each shape contributes a pure
  `(size, adjustments) => Path2D` function; a shared renderer applies
  fill / stroke / theme color resolution. `line` and `arrow` remain
  special (they are not closed paths and arrow paints a two-tone head).
- Replace the inline 5-button insert strip with a single **Shape ▾**
  popover, organized into category sections (Lines / Shapes / Block
  Arrows / Callouts / Equation), with icons rendered from the same
  path builders so picker thumbnails track shape geometry without a
  separate icon asset.
- Ship 35 shapes that paint correctly with theme colors, work under
  resize / rotate, and round-trip through the existing Yorkie store
  schema without migration.

### Success metric

After Phase 1, a user opening the **Shape ▾** picker sees the 35
shapes a Google Slides user reaches for first (basic geometry, the
common block arrows, four callouts, six equation symbols). Existing
`rect`/`ellipse`/`line`/`arrow` documents continue to render and
remain editable with no data migration.

## Non-Goals

- **Adjustments editing UI** — the `adjustments` field is *stored* but
  never *edited* in P1. Shapes use code defaults (e.g. roundRect
  corner radius = 8px, star points = 5). P2 adds toolbar number
  inputs; P3 adds drag handles (yellow diamonds). P1 does not block
  on either.
- **Shapes 31–187** — Phase 2 adds 14 flowchart + 6 stars (= 50);
  Phase 3 adds the rest of GS parity (= 100); Phase 4 introduces a
  DrawingML `prstGeom` formula evaluator that handles the remaining
  87 presets. P1 does not touch those.
- **PPTX importer** — currently unimplemented in the codebase
  (only `prstGeom` reference is the docx exporter, unrelated). P1's
  ShapeKind expansion is *forward-compatible* with the importer
  designed in `slides-themes-layouts-import.md`, but P1 does not ship
  the importer itself.
- **Connector behavior** — `line` and `arrow` continue to be
  free-floating; "elbow connector" / "curved connector" between two
  elements is a separate workstream.
- **Shape-internal text** — text inside a shape continues to be a
  separate `TextElement` overlapping the shape, as today. Integrated
  text-with-shape (one element) is not P1.
- **Hit-testing precision** — selection still uses the rotated frame
  AABB. Path-precise hit-testing using the new `Path2D` is a
  follow-up (out of P1 scope).

## Roadmap context

| Phase | Cumulative shapes | Adds | Adjustments UX | Picker categories |
|---|---|---|---|---|
| **P1 — Foundation** (this doc) | 35 | 2 lines (existing) + 15 basic + 8 block arrows + 4 callouts + 6 equation | none (defaults only) | Lines · Shapes · Block Arrows · Callouts · Equation |
| **P2 — Practical** | 55 | flowchart 14 + stars 6 | toolbar number inputs | + Flowchart · Stars |
| **P3 — GS Parity** | 105 | extra callouts/arrows/banners + actionButtons 12 | drag handles (yellow diamonds) | + Action Buttons |
| **P4 — OOXML Full** | 187 | remaining presets via DrawingML formula evaluator | (no new UX, all adjustments work) | (no new categories) |

P1 must therefore lock decisions that ripple through P2–P4: the
`adjustments` field shape, the path-builder registry signature, the
picker's category-popover model, and the OOXML-aligned naming.

## Proposal Details

### 1. Data model

`packages/slides/src/model/element.ts:23` changes from:

```ts
export type ShapeKind = 'rect' | 'ellipse' | 'line' | 'arrow';

export type ShapeElement = ElementBase & {
  type: 'shape';
  data: {
    kind: ShapeKind;
    fill?: ThemeColor;
    stroke?: ShapeStroke;
  };
};
```

to:

```ts
export type ShapeKind =
  // Lines (special-cased renderers)
  | 'line' | 'arrow'
  // Basic shapes (15)
  | 'rect' | 'roundRect' | 'ellipse'
  | 'triangle' | 'rtTriangle'
  | 'diamond' | 'parallelogram' | 'trapezoid'
  | 'pentagon' | 'hexagon' | 'octagon'
  | 'plus' | 'donut' | 'can' | 'cloud'
  // Block arrows (8)
  | 'rightArrow' | 'leftArrow' | 'upArrow' | 'downArrow'
  | 'leftRightArrow' | 'quadArrow' | 'chevron' | 'pentagonArrow'
  // Callouts (4)
  | 'wedgeRectCallout' | 'wedgeRoundRectCallout'
  | 'wedgeEllipseCallout' | 'cloudCallout'
  // Equation (6)
  | 'mathPlus' | 'mathMinus' | 'mathMultiply'
  | 'mathDivide' | 'mathEqual' | 'mathNotEqual';

export type ShapeElement = ElementBase & {
  type: 'shape';
  data: {
    kind: ShapeKind;
    /**
     * OOXML-aligned per-shape adjustments. Mirrors `<a:avLst><a:gd>`
     * values from DrawingML. Path builders read this with sensible
     * defaults when missing or shorter than expected. P1 does not
     * provide an editing UI; defaults are used in practice. Stored
     * here from day one so P2/P3/P4 add UX without data migration.
     *
     * Units / interpretation are per-shape and documented in the
     * builder file. We follow OOXML's "thousandths" convention where
     * applicable (e.g. roundRect cornerRadius is 0..50000 = 0..50%
     * of the shorter side).
     */
    adjustments?: number[];
    fill?: ThemeColor;
    stroke?: ShapeStroke;
  };
};
```

Notes:

- All 35 names match OOXML `prstGeom` preset values **except the
  equation prefix `math*`**. OOXML's equation presets (`plus`,
  `minus`, `multiply`, `divide`, `equal`, `notEqual`) collide with
  the existing `plus` basic shape (an arithmetic-style `+` cross
  block). We disambiguate the equation glyphs with a `math` prefix;
  the importer maps `prst="plus"` → `'plus'` and `prst="mathPlus"`
  → `'mathPlus'` (OOXML uses `mathPlus` in newer schemas; older
  decks use category context — the importer can disambiguate by
  inspecting the host's category metadata, deferred to importer
  workstream).
- No `presetName: string` escape hatch is introduced in P1. Phase 4
  will extend `ShapeKind` with `'preset'` and add
  `data.presetName: string` for the unknown-preset slot. Reserving
  the slot now would expose an unused field; keep the model minimal
  for P1.
- Existing documents have `data.adjustments` undefined; renderers
  apply defaults. No Yorkie migration runs.

### 2. Renderer architecture

#### Directory layout

```
packages/slides/src/view/canvas/
├── shape-renderer.ts          # dispatcher (line/arrow → special; rest → builder + shared fill/stroke)
├── shape-special.ts           # drawLine, drawArrow (current logic, moved out of shape-renderer.ts)
└── shapes/
    ├── index.ts               # registry: Map<ShapeKind, PathBuilder>
    ├── builder.ts             # types: PathBuilder, AdjustmentSpec, registry helpers
    ├── basic/
    │   ├── rect.ts
    │   ├── round-rect.ts
    │   ├── ellipse.ts
    │   ├── triangle.ts
    │   ├── rt-triangle.ts
    │   ├── diamond.ts
    │   ├── parallelogram.ts
    │   ├── trapezoid.ts
    │   ├── pentagon.ts
    │   ├── hexagon.ts
    │   ├── octagon.ts
    │   ├── plus.ts
    │   ├── donut.ts
    │   ├── can.ts
    │   └── cloud.ts
    ├── arrows/
    │   ├── right-arrow.ts
    │   ├── left-arrow.ts
    │   ├── up-arrow.ts
    │   ├── down-arrow.ts
    │   ├── left-right-arrow.ts
    │   ├── quad-arrow.ts
    │   ├── chevron.ts
    │   └── pentagon-arrow.ts
    ├── callouts/
    │   ├── wedge-rect-callout.ts
    │   ├── wedge-round-rect-callout.ts
    │   ├── wedge-ellipse-callout.ts
    │   └── cloud-callout.ts
    └── equation/
        ├── math-plus.ts
        ├── math-minus.ts
        ├── math-multiply.ts
        ├── math-divide.ts
        ├── math-equal.ts
        └── math-not-equal.ts
```

#### Path builder contract

```ts
// shapes/builder.ts
export type FrameSize = { w: number; h: number };

export type PathBuilder = (
  size: FrameSize,
  adjustments?: number[],
) => Path2D;

/**
 * Each path builder file declares its adjustment spec — index, name,
 * default, min/max — for documentation and for the P2 toolbar UI to
 * reflectively build inputs without per-shape switch statements.
 */
export type AdjustmentSpec = {
  name: string;            // human-readable: "Corner radius"
  defaultValue: number;    // canonical default (in OOXML units)
  min: number;
  max: number;
  /** Optional formatter for display (e.g. "8 px", "50%"). */
  format?: (value: number) => string;
};
```

Per-shape file shape:

```ts
// shapes/basic/round-rect.ts
import type { PathBuilder, AdjustmentSpec } from '../builder';

export const ROUND_RECT_ADJUSTMENTS: AdjustmentSpec[] = [
  { name: 'Corner radius', defaultValue: 16667, min: 0, max: 50000 },
];

export const buildRoundRect: PathBuilder = ({ w, h }, adj) => {
  const ratio = (adj?.[0] ?? ROUND_RECT_ADJUSTMENTS[0].defaultValue) / 100000;
  const r = Math.min(w, h) * ratio;
  const path = new Path2D();
  path.moveTo(r, 0);
  path.lineTo(w - r, 0);
  path.quadraticCurveTo(w, 0, w, r);
  path.lineTo(w, h - r);
  path.quadraticCurveTo(w, h, w - r, h);
  path.lineTo(r, h);
  path.quadraticCurveTo(0, h, 0, h - r);
  path.lineTo(0, r);
  path.quadraticCurveTo(0, 0, r, 0);
  path.closePath();
  return path;
};
```

Registry:

```ts
// shapes/index.ts
import { buildRect } from './basic/rect';
import { buildRoundRect } from './basic/round-rect';
// … (31 more)

export const PATH_BUILDERS: ReadonlyMap<ShapeKind, PathBuilder> = new Map([
  ['rect', buildRect],
  ['roundRect', buildRoundRect],
  // …
]);

export const ADJUSTMENT_SPECS: ReadonlyMap<ShapeKind, readonly AdjustmentSpec[]> = new Map([
  ['roundRect', ROUND_RECT_ADJUSTMENTS],
  // … only shapes with adjustments
]);
```

#### Dispatcher

```ts
// shape-renderer.ts
export function drawShape(ctx, size, data, theme) {
  if (data.kind === 'line') return drawLine(ctx, size, data, theme);
  if (data.kind === 'arrow') return drawArrow(ctx, size, data, theme);

  const builder = PATH_BUILDERS.get(data.kind);
  if (!builder) {
    // Forward-compat: unknown ShapeKind (e.g. P4 'preset' before its
    // builder is registered) falls back to a placeholder rect so the
    // slide still renders. Logged once per kind via console.warn.
    return drawPlaceholderRect(ctx, size, data, theme);
  }
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

This eliminates per-shape `fillStyle = resolveColor(...)` /
`fill()` / `stroke()` boilerplate; each path builder is pure
geometry, easy to test and review.

### 3. Shape catalog (35 shapes)

Default fill / stroke conventions:

| Category | Default fill | Default stroke |
|---|---|---|
| Lines | (none) | `role: 'text'`, width 2 |
| Shapes (basic) | `role: 'accent1'` | (none) |
| Block Arrows | `role: 'accent1'` | (none) |
| Callouts | `role: 'background'` | `role: 'text'`, width 2 |
| Equation | `role: 'accent1'` | (none) |

Catalog (30):

| # | Kind | OOXML `prst` | Adjustments (defaults in OOXML units) |
|---|---|---|---|
| **Lines (2, special)** | | | |
| 1 | `line` | `line` | — |
| 2 | `arrow` | `straightConnector1` | — |
| **Basic Shapes (15)** | | | |
| 3 | `rect` | `rect` | — |
| 4 | `roundRect` | `roundRect` | `[16667]` (corner ratio of shorter side) |
| 5 | `ellipse` | `ellipse` | — |
| 6 | `triangle` | `triangle` | `[50000]` (apex x) |
| 7 | `rtTriangle` | `rtTriangle` | — |
| 8 | `diamond` | `diamond` | — |
| 9 | `parallelogram` | `parallelogram` | `[25000]` (slant) |
| 10 | `trapezoid` | `trapezoid` | `[25000]` (top inset) |
| 11 | `pentagon` | `pentagon` | — |
| 12 | `hexagon` | `hexagon` | `[25000]` (notch depth) |
| 13 | `octagon` | `octagon` | `[29289]` (corner cut) |
| 14 | `plus` | `plus` | `[25000]` (arm thickness) |
| 15 | `donut` | `donut` | `[25000]` (hole ratio) |
| 16 | `can` | `can` | `[25000]` (top ellipse height) |
| 17 | `cloud` | `cloud` | — |
| **Block Arrows (8)** | | | |
| 18 | `rightArrow` | `rightArrow` | `[50000, 50000]` (head len, head width) |
| 19 | `leftArrow` | `leftArrow` | `[50000, 50000]` |
| 20 | `upArrow` | `upArrow` | `[50000, 50000]` |
| 21 | `downArrow` | `downArrow` | `[50000, 50000]` |
| 22 | `leftRightArrow` | `leftRightArrow` | `[50000, 50000]` |
| 23 | `quadArrow` | `quadArrow` | `[22500, 22500, 22500]` |
| 24 | `chevron` | `chevron` | `[50000]` (notch depth) |
| 25 | `pentagonArrow` | `homePlate` | `[50000]` (point length) |
| **Callouts (4)** | | | |
| 26 | `wedgeRectCallout` | `wedgeRectCallout` | `[-20833, 62500]` (tail x, y in % of frame) |
| 27 | `wedgeRoundRectCallout` | `wedgeRoundRectCallout` | `[-20833, 62500, 16667]` (tail x, tail y, corner radius) |
| 28 | `wedgeEllipseCallout` | `wedgeEllipseCallout` | `[-20833, 62500]` |
| 29 | `cloudCallout` | `cloudCallout` | `[-20833, 62500]` |
| **Equation (6)** | | | |
| 30 | `mathPlus` | `mathPlus` | `[23520]` (arm thickness) |
| 31 | `mathMinus` | `mathMinus` | `[23520]` |
| 32 | `mathMultiply` | `mathMultiply` | `[23520]` |
| 33 | `mathDivide` | `mathDivide` | `[23520, 5880, 11760]` |
| 34 | `mathEqual` | `mathEqual` | `[23520, 11760]` |
| 35 | `mathNotEqual` | `mathNotEqual` | `[23520, 11760, 6600]` |

Total: **35 kinds = 2 lines + 15 basic + 8 block arrows + 4 callouts
+ 6 equation**. Of those, 4 (`line`, `arrow`, `rect`, `ellipse`)
already render in the codebase; rect/ellipse get refactored into the
new path-builder pattern. P1 ships **31 brand-new path builders + 2
refactored builders + 2 unchanged specials**.

OOXML adjustment defaults are taken from ECMA-376 Part 1 §20.1.9
preset definitions; values mirror what PowerPoint paints by default.

### 4. Picker UI

#### Toolbar change

`packages/frontend/src/app/slides/slides-formatting-toolbar.tsx:70-76`
goes from a 5-button inline strip to:

```
[ T ] Text box   [ ▾ Shape ]
```

Clicking **Shape ▾** opens a popover (Radix `Popover`) below the
button.

#### Popover layout

- Width ~ 280 px, max-height 480 px (scrolls).
- Sections, in order: **Lines · Shapes · Block Arrows · Callouts ·
  Equation**.
- Each section is a 6-column grid of 32 × 32 px buttons; each button
  contains a 24 × 24 px shape preview rendered through the same
  path-builder used by the canvas, with `role: 'text'` outline and no
  fill (so previews work on both light and dark UI themes).
- Section header is a small uppercase label.
- Hover tooltip shows the shape name (the `name` from `INSERT_BUTTONS`
  table, kept localizable).
- Clicking a shape calls `editor.setInsertMode(kind)` exactly like the
  current 4 buttons; the next pointer drag on the slide creates that
  shape (existing `dragAdd` flow in `insert.ts`).

#### Icon rendering

A small helper `renderShapeIcon(kind, ctx, size)` instantiates the
path builder, paints an outline-only stroke in `currentColor`, and
returns. The picker mounts a `<canvas>` per cell with this drawn at
DPR-aware resolution. Total memory: 35 × 24² px ≈ 20 KB, drawn once
when the popover first opens.

This eliminates the need to maintain SVG icons in
`@tabler/icons-react` (the current `IconSquare`, `IconCircle`,
`IconLine`, `IconArrowRight` for our 4 shapes). New shapes ship with
a path builder and become visible in the picker automatically — no
icon synchronisation work.

#### `InsertKind` type

Currently in `editor.ts` (exported, used by toolbar +
`buildInsertElement`). Extends to the same union as `ShapeKind` plus
`'text'`. `buildInsertElement` switch grows from 5 cases to 31; each
new case applies the category default fill / stroke from the table
above:

```ts
// insert.ts (sketch)
const FILLED_DEFAULT = { fill: { kind: 'role', role: 'accent1' } };
const CALLOUT_DEFAULT = {
  fill: { kind: 'role', role: 'background' },
  stroke: { color: { kind: 'role', role: 'text' }, width: 2 },
};
// per-kind dispatch table replacing the existing switch
```

A small per-category table inside `insert.ts` keeps the file under
~120 lines.

### 5. Test strategy

- **Path builder unit tests** (`shapes/<file>.test.ts`, one per
  shape): construct `Path2D`, verify expected control points using
  `ctx.isPointInPath(path, x, y)` for inside/outside reference points.
  Example for `roundRect`: corner cells outside (clipped), interior
  inside, 16-px-from-corner inside. ~5 assertions per shape × 33
  builders (31 new + rect/ellipse refactored) = ~165 assertions, fast
  (no real canvas needed; jsdom canvas via existing
  `test-canvas-env.ts`).
- **Renderer integration test** (extend `shape-renderer.test.ts`):
  for one representative shape per category, assert that the shared
  dispatcher resolves theme color, applies fill *and* stroke
  correctly, and falls back to a placeholder rect for unknown kinds.
- **Picker UI test** (Vitest + RTL, in
  `packages/frontend/tests/app/slides/`): popover opens, all 35
  shapes have a button with the right aria-label, clicking sets
  insert mode, ESC closes.
- **Snapshot test for default `data.adjustments = undefined`**: each
  builder paints the OOXML default geometry — verified via a single
  snapshot test that walks the registry and renders each shape into
  a fixed 100 × 100 frame (ctx-spy log).
- **No new Yorkie integration test** is required — the data model
  change is additive (`adjustments?: number[]`) and existing
  `kind: 'rect' | …` round-trip is unchanged.

### 6. Migration & backwards compatibility

- **Yorkie schema**: `ShapeElement.data.adjustments` is added as
  optional. Existing documents serialise it as undefined; the
  YorkieStore mirror does not need a migration step. The migrate.ts
  no-op covers this — no version bump.
- **Frontend toolbar**: the old 4-button strip disappears in the
  same PR that ships the picker popover. No transitional period; the
  popover is strictly more capable.
- **External code** referencing `ShapeKind` (search shows uses only
  inside the slides package + frontend tests + `node.ts` re-export)
  picks up the new union automatically. Tests using
  `kind: 'rect' | 'ellipse' | ...` keep compiling; new kinds are
  additive.

## Risks and Mitigation

### Risk: per-shape geometry bugs at small sizes

Some shapes (donut, callouts, plus) become geometrically degenerate
when frames are very small or extreme aspect ratios. A 5 × 5 px
donut has hole > outer.

**Mitigation**: Each builder clamps adjustment-derived parameters to
`[0, min(w, h) / 2]` (or the equivalent invariant for the shape) so
the path stays well-formed. The path-builder unit test covers the
"squashed" frame case (1 × 100 and 100 × 1). For frames smaller than
the current selection-handle minimum (30 × 30 px enforced in
selection logic), the slide renderer is allowed to produce visually
"clamped" geometry — selection prevents creation below that threshold.

### Risk: picker icon rendering quality

Canvas-rendered icons at 24 × 24 px can look blurry vs hand-tuned
SVG.

**Mitigation**: Render at `2 × DPR` and scale down with `image-rendering`
CSS hints; outline at 1.5 px stroke for visual weight at small sizes.
If real-world quality is unacceptable, a fallback is to ship hand-tuned
24 × 24 SVG icons for the 35 shapes (one-time work, ~1 day) — the
data model and renderer are unaffected, only the picker swaps icon
source.

### Risk: equation / basic `plus` collision

OOXML has both `plus` (basic shape, large `+` block) and `mathPlus`
(equation glyph, thin `+`). Newer OOXML uses `mathPlus`; older decks
may emit `plus` in equation contexts.

**Mitigation**: P1 ships both `plus` (basic) and `mathPlus`
(equation) as separate kinds. The future PPTX importer will need to
inspect host context to disambiguate — that's the importer
workstream's problem, not P1's. Wafflebase-authored decks always use
the unambiguous kind picked from the picker.

### Risk: scope creep into adjustments UI

The temptation to "just add a corner radius slider for roundRect"
during P1 review is high.

**Mitigation**: P2 is reserved for adjustments UI exactly so P1 ships
fast. Any toolbar-input PR opened during P1 review gets deferred. The
`adjustments` field is the contract; once it lands, P2 is purely
additive.

### Risk: `Path2D` polyfill / browser parity

Some JSDOM canvas implementations have incomplete `Path2D` support
(notably `quadraticCurveTo` on certain versions).

**Mitigation**: `test-canvas-env.ts` already pins a JSDOM canvas
version; verify in P1's first PR that all 33 builders run under
the test runner. If a primitive is missing, fall back to manual
`ctx.beginPath() + lineTo + ...` inside the builder (the
public signature `(size, adjustments) => Path2D` stays the same; a
small `pathFromCommands` helper handles the construction).

## Out-of-scope follow-ups (recorded for later phases)

| Phase | Item |
|---|---|
| P2 | Toolbar number-input UI for `adjustments`; +20 shapes (flowchart 14 + stars 6) |
| P3 | Drag-handle (yellow-diamond) editor for `adjustments`; +50 shapes for GS parity; action button click handlers in presentation mode |
| P4 | DrawingML `prstGeom` formula evaluator (AVList + guide formulas); `kind: 'preset'` + `presetName: string` slot for unknown-preset import; replace hand-coded builders for shapes the engine handles |
| Importer | Map all 35 P1 kinds in `prst → ShapeKind` table when the PPTX importer ships (see `slides-themes-layouts-import.md`) |
| Selection | Path-precise hit-testing using `ctx.isPointInPath(path, x, y)` (replaces frame AABB for click-through-the-hole-of-donut UX) |
| Connectors | Elbow / curved connectors that snap to two source elements (separate workstream, not part of the static shape library) |
