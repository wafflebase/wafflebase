---
title: slides-shapes-p3a-adjustments
target-version: 0.7.0
---

# Slides Shape Library — Phase 3-A.1 (Adjustments Drag Handles, pilot)

## Summary

P1 (`slides-shapes-p1.md`) and P2 (`slides-shapes-p2.md`) shipped the
55-shape catalog and registered 33 entries in `ADJUSTMENT_SPECS` —
the data model for OOXML-aligned per-shape adjustments — but no
editing UI. P2 explicitly deferred the adjustments UX into P3,
consolidated around Google Slides' canonical pattern of
**yellow-diamond drag handles on the canvas**.

P3-A is the adjustments-UX workstream. Because per-shape handle
geometry has to be authored individually for ~33 shapes covering
four distinct axis types (radial, linear, point, multi-axis), the
work is split:

- **P3-A.1 (this doc, pilot)** — 9 shapes covering all four axis
  types, validates the handle abstraction, the drag/Yorkie loop, the
  handle z-order against existing resize handles, and the visual
  baseline. Adds one shared registry (`ADJUSTMENT_HANDLES`) and a
  reusable interaction module.
- **P3-A.2 (follow-up, sweep)** — registers the remaining 24 shapes
  on the same registry; no new abstractions.

P3-A is shipped before P3-B (next 50 shapes for GS parity) so that
the additional shapes inherit a working adjustments UX rather than
landing inert.

## Goals

- Add yellow-diamond drag handles for **9 pilot shapes**, exercising
  all four adjustment axis types in a single PR: radial (6 stars),
  linear (`roundRect`, `chevron`), and point (`wedgeRectCallout`).
- Introduce one new registry — `ADJUSTMENT_HANDLES: Map<ShapeKind,
  readonly AdjustmentHandle[]>` — that lets P3-A.2 add the remaining
  24 shapes by registration only, without further core changes.
- Reuse the existing resize-drag pattern (`pointermove` paints
  locally, `pointerup` commits a single `store.batch` update,
  single-select only) so adjustments produce one undo entry per
  drag, identical to resize.
- Ship without a Yorkie schema migration — `data.adjustments` already
  exists since P1; P3-A.1 just starts populating it through user
  interaction. Existing P1/P2 documents render bit-identical until
  the user drags a handle.

### Success metric

After P3-A.1, a user editing one of the 9 pilot shapes sees a yellow
diamond on the selected shape, can drag it to change the shape's
defining parameter (corner radius / inner-ring ratio / chevron notch
/ callout tail position), sees a live preview during drag with a
small percentage tooltip, and gets one undo entry per drag. The
remaining 24 shapes with `ADJUSTMENT_SPECS` entries render exactly
as today (no handle, defaults still applied).

## Non-Goals

- **Number-input UI.** The popover/sidebar number-input fallback is
  deferred. A drag-only UX matches Google Slides' default behavior
  and `AdjustmentSpec.format` already gives us the readout for the
  drag tooltip — the number input is additive polish, not blocking.
- **Sweep of remaining 24 shapes.** All P1/P2 shapes that have
  `ADJUSTMENT_SPECS` entries but are not in the 9 pilot list (e.g.
  `triangle`, 8 arrows, 3 other callouts, 6 equation shapes,
  `parallelogram`, `trapezoid`, `hexagon`, `octagon`, `plus`,
  `donut`, `can`) keep their default-only behavior in P3-A.1. They
  follow in P3-A.2 once the pattern is locked.
- **Multi-selection adjustment.** Like resize, handles only show on
  single-selection. A multi-select adjustment would need a "what
  does dragging mean across heterogeneous shapes" answer that doesn't
  exist in Google Slides either.
- **Snap to other elements / guides.** Adjustment handles snap only
  to their own default value (Shift modifier). Cross-element
  alignment snapping is out of scope.
- **PPTX import of authored adjustments.** The Yorkie round-trip is
  in scope; PPTX read/write of `<a:avLst><a:gd>` remains tracked
  under `slides-themes-layouts-import.md`.

## Proposal Details

### 1. Pilot scope (9 shapes, 4 axis types)

| Axis type | ShapeKind | Adjustment(s) controlled | Handle position |
|---|---|---|---|
| Radial | `star4` | `[0]` inner ratio | first inner-ring vertex (between the apex outer vertex and the next outer vertex, clockwise) |
| Radial | `star5` | `[0]` inner ratio | first inner-ring vertex |
| Radial | `star6` | `[0]` inner ratio | first inner-ring vertex |
| Radial | `star7` | `[0]` inner ratio | first inner-ring vertex |
| Radial | `star8` | `[0]` inner ratio | first inner-ring vertex |
| Radial | `star10` | `[0]` inner ratio | first inner-ring vertex |
| Linear | `roundRect` | `[0]` corner radius ratio | inset along top edge by `r` |
| Linear | `chevron` | `[0]` notch depth | inner tip of the back-side V notch — `(inset, h/2)` where `inset = (notch/100000) × (h/2) × (w/h)` |
| Point | `wedgeRectCallout` | `[0..1]` tail tip x,y | tail tip in element-local coords |

`triangle` is intentionally excluded from the pilot despite being
the simplest linear axis (apex x-position) — it is structurally
identical to `chevron` and adds no axis-type coverage. It will land
in P3-A.2 along with the other 23 shapes. Same reasoning excludes
`parallelogram`, `trapezoid`, `hexagon`, `octagon`, `plus`, `donut`,
`can`, the 8 arrows, the 3 other callouts, and the 6 equation shapes.

### 2. Core abstraction

A new registry parallel to `PATH_BUILDERS` and `ADJUSTMENT_SPECS`:

```ts
// packages/slides/src/view/canvas/shapes/builder.ts
export type Point = { x: number; y: number };

export type AdjustmentHandle = {
  /**
   * Where to draw the yellow diamond, in element-local coords
   * (origin = frame top-left, axes = pre-rotation). The caller
   * applies the rotation transform once when painting.
   */
  position: (frame: FrameSize, adjustments: number[]) => Point;
  /**
   * Inverse: given the live drag pointer in the same element-local
   * coords, return the FULL new adjustments array. The handle
   * decides which indices it controls; indices it does not control
   * must come through unchanged from `startAdjustments`. Values are
   * clamped to the `min` / `max` declared on the corresponding
   * `AdjustmentSpec`.
   */
  apply: (
    frame: FrameSize,
    startAdjustments: number[],
    pointer: Point,
  ) => number[];
};
```

Registered alongside the path builders:

```ts
// packages/slides/src/view/canvas/shapes/index.ts
export const ADJUSTMENT_HANDLES = new Map<
  ShapeKind,
  readonly AdjustmentHandle[]
>();

ADJUSTMENT_HANDLES.set('star4', STAR_4_HANDLES);
ADJUSTMENT_HANDLES.set('star5', STAR_5_HANDLES);
// … 7 more in the pilot …
```

#### Why this shape

- **One handle, N adjustments**: a single `AdjustmentHandle` returns
  the *full* `adjustments` array from `apply`, so a point-axis handle
  (callout tail) writes both `[0]` and `[1]` in one drag. A
  declarative-axis spec would force a 1-handle-per-adjustment model
  that's awkward for 2D points.
- **Element-local coords throughout**: rotation/scale transforms are
  the editor's job, not the shape's. The shape implements pure
  geometry. P1's `PathBuilder` already follows this convention;
  reusing it keeps the mental model consistent.
- **Pointer absolute, not delta**: `apply` receives the current
  pointer position rather than `(dx, dy)`. Radial inverse needs
  distance from center, linear needs absolute projection,
  point-axis needs absolute coords — none of them naturally consume
  a delta. Passing absolute pointer + `startAdjustments` makes each
  shape's math one-line.
- **Unregistered kinds are no-ops**: shapes not in
  `ADJUSTMENT_HANDLES` get zero handles. P3-A.2 grows the map without
  touching anything else.

#### Per-axis math sketch

- **Radial (stars)**: the path builder inscribes the star in an
  ellipse with `rx = w/2`, `ry = h/2`; the inner ring sits at
  `(rx × ratio, ry × ratio)`. To keep the handle math invariant
  under non-square frames, both `position` and `apply` work in
  **unit-ellipse space** — coordinates pre-divided by `(rx, ry)`
  so the outer ring is a unit circle and `ratio` is literally a
  radius in that space.

  **Position**: the first inner-ring vertex (vertex index 0 of the
  inner ring `regularPolygonPath` produces with rotation
  `-π/2 + π/N` — geometrically the vertex immediately clockwise
  of the apex outer vertex, on the bisector between the apex and
  its first clockwise neighbor). Compute its element-local
  position as `(cx + ratio × rx × cos θ, cy + ratio × ry × sin θ)`
  where `θ = -π/2 + π/N` and `(cx, cy) = (w/2, h/2)`.

  **Apply**: normalize the pointer into unit-ellipse space —
  `u = (pointer.x - cx) / rx`, `v = (pointer.y - cy) / ry` — then
  project onto the unit vector `(cos θ, sin θ)`:
  `radial = max(0, u × cos θ + v × sin θ)`. Map to OOXML thousandths
  via `ratio = clamp(radial, 0, 1) × 100000`. Projecting along the
  handle's ray (rather than raw `hypot`) means perpendicular wiggle
  doesn't change the value, which feels stable.
- **Linear (roundRect)**: position at `(adj0 / 100000 * min(w, h), 0)`
  along the top edge. `apply` inverts:
  `r = clamp(pointer.x, 0, min(w, h) / 2)`,
  `adj0 = round(r / min(w, h) * 100000)`.
- **Linear (chevron)**: position at the inner tip of the back-side
  V notch (left edge of the chevron). The path builder computes
  `inset = (adj0 / 100000) × (h / 2) × (w / h)`; the handle sits at
  `(inset, h/2)`. `apply` inverts:
  `inset = clamp(pointer.x, 0, w)`,
  `adj0 = round(inset / (h/2 × w/h) × 100000)`. Vertical pointer
  motion is ignored.
- **Point (wedgeRectCallout)**: position at
  `(w/2 + adj0/100000 × w, h/2 + adj1/100000 × h)` — adjustments are
  signed thousandths *relative to the frame center*, matching the
  path builder. `apply` inverts both components independently
  (`adj_n = round((pointer.n - center.n) / dim_n × 100000)`) and
  clamps each to its spec range.

### 3. Renderer / interaction integration

#### Editor wiring (existing `editor.ts`)

```ts
// pseudocode of the new interaction path
private startAdjustmentDrag(
  elementId: string,
  handleIndex: number,
  clientX: number,
  clientY: number,
): void {
  const startSlide = this.currentSlide();
  const startEl = startSlide.elements.find((e) => e.id === elementId);
  const startAdjustments = startEl.data.adjustments
    ?? defaultAdjustmentsFor(startEl.data.kind); // expand defaults from ADJUSTMENT_SPECS
  const handle = ADJUSTMENT_HANDLES.get(startEl.data.kind)![handleIndex];
  const startPointer = this.clientToLogical(clientX, clientY);
  let live = startAdjustments;
  let moved = false;

  const onMove = (ev: MouseEvent) => {
    const cur = this.clientToLogical(ev.clientX, ev.clientY);
    if (!moved && distance(cur, startPointer) < 2) return; // 2px threshold
    moved = true;
    const localPointer = worldToElementLocal(cur, startEl.frame);
    let next = handle.apply(startEl.frame, startAdjustments, localPointer);
    if (ev.shiftKey) next = snapToDefaults(startEl.data.kind, next);
    live = next;
    this.paintLiveAdjustments(elementId, next); // local-only redraw
    this.showAdjustmentTooltip(startEl.data.kind, next);
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    this.hideAdjustmentTooltip();
    if (!moved) return; // never crossed threshold; nothing to commit
    this.options.store.batch(() => {
      this.options.store.updateElementData(startSlide.id, elementId, {
        adjustments: live,
      });
    });
    this.renderer.markDirty();
    this.render();
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}
```

This mirrors `startResize` (`editor.ts:850`) one-to-one — the only
deltas are the handle abstraction call, `updateElementData` instead
of `updateElementFrame`, and the tooltip overlay.

#### New interaction module

```text
packages/slides/src/view/editor/interactions/adjustment.ts
├── hitAdjustmentHandle(slide, selectedId, worldPoint)
│       → { elementId, handleIndex } | null
├── snapToDefaults(kind, adjustments)
│       → adjustments  (Shift snap; uses ADJUSTMENT_SPECS defaults)
└── defaultAdjustmentsFor(kind)
        → number[]      (expand spec defaults; used when data.adjustments missing)
```

`hitAdjustmentHandle` runs **after** `hitResizeHandle` in the
editor's pointerdown handler. Handles are hit-tested in their post-
rotation world positions with an 8px square hit area (slightly
larger than the visual diamond to forgive aim). Adjustment handles
take priority over the underlying shape body but yield to the
existing resize/rotate handles only when the latter spawn at the
same point — in practice they don't overlap because the shape body
is between them.

The 8px hit area against the 8px visual is enough margin for
typical authoring. If a particular pilot shape has the adjustment
handle inside the resize-handle bounding circle (e.g. `roundRect`
with `r=0`), an 8px **inset guard** in the position function moves
the diamond away from the corner — the data still reaches `r=0`,
the *handle* just refuses to render closer than 8px from the edge.

#### Visual style

| Property | Value |
|---|---|
| Shape | 8 × 8 px diamond (rotated square) |
| Fill | `#FFD500` (Google Slides yellow) |
| Stroke | 1px, `role: 'text'` color |
| DPR | scaled at paint time, identical to existing resize handles |
| Hover | fill darkens to `#E5BD00`; cursor switches to `pointer` |
| Drag | tooltip appears 12px to upper-right of handle |

#### Tooltip

DOM overlay div positioned in viewport coords, `role="status"`,
`aria-live="polite"`. Content is `AdjustmentSpec.format(value)` for
single-axis; for `wedgeRectCallout` it concatenates both formatted
values: `"x: 75.0% / y: 100.0%"`. Removed on pointerup. The DOM
overlay sits in the existing editor-overlay DOM container so it
participates in the same z-stacking as resize indicators.

#### Z-order summary

Selection chrome is DOM — `renderOverlay` clears
`overlay.innerHTML` and rebuilds child `<div>`s with `data-handle`
attributes (`nw`, `n`, …, `rotate`). Hit-test reads `data.handle`
via `handleHitTest`. Adjustment handles slot into the same DOM
overlay using a `data-handle` value of `adjust-${handleIndex}`.

```
canvas (background):
  1. slide background
  2. element renderers (text/image/shape, including live-painted preview)
DOM overlay (above canvas):
  3. selection frame (dashed border <div>)
  4. resize handles (8 squares + rotate handle, data-handle="nw"…"rotate")
  5. adjustment handles (yellow diamonds, data-handle="adjust-0"…)
  6. adjustment-drag tooltip (only visible during drag)
```

Adjustment handles are appended **after** resize handles in the
DOM overlay, giving them higher stacking order (later siblings
paint on top in CSS) and higher hit priority (DOM elementFromPoint
returns the topmost element). The `handleHitTest` helper widens
its return type to include the new `adjust-${i}` values; the
editor's pointerdown handler routes them to
`startAdjustmentDrag`.

### 4. Data / collaboration

- **No new store API.** `Store.updateElementData(slideId, elementId,
  patch)` (`store.ts:55`) accepts arbitrary `object` patches and is
  used today for image `crop`, alt text, etc. Adjustment commits go
  through the same path with `{ adjustments: number[] }`.
- **No schema migration.** `ShapeElement.data.adjustments?:
  number[]` exists since P1 (`element.ts:105`). When missing, path
  builders fall back to defaults declared in each shape's
  `AdjustmentSpec`. The first time a user drags a handle, the array
  becomes present; from then on it is non-default and persisted.
- **Concurrent edit semantics.** `adjustments` is a JSON array stored
  inside the element's `data` object. Yorkie treats it as last-write-
  wins on commit, identical to `ImageElement.data.crop` and
  `ShapeElement.data.fill`. The `pointerup`-only commit cadence means
  each user produces one update per drag, so concurrent dragging of
  the same star's inner ratio resolves to the last `pointerup`.
- **Undo.** Single `store.batch` per drag → one undo entry. Pre-
  threshold drags (< 2px) commit nothing → no undo entry, matching
  cancelled clicks elsewhere.

### 5. Test strategy

- **Per-shape unit tests** (9 files, e.g.
  `shapes/stars/star5.handles.test.ts`):
  - `position` at default / min / max adjustments returns expected
    coords (3 cases each).
  - `apply` for representative pointer positions returns expected
    adjustments (3 cases each, including out-of-range pointers that
    must clamp to spec min/max).
  - Round-trip identity: `apply(frame, adj, position(frame, adj))`
    ≈ `adj` within ±50 OOXML units, for `adj` strictly inside the
    `min..max` range. Boundary `adj` values are tested separately
    because clamping breaks identity by definition.
- **Builder type test** (`shapes/builder.test.ts`): one compile-time
  check that `AdjustmentHandle` accepts the pilot shapes' shapes
  (TypeScript-only; ensures the contract doesn't drift).
- **Registry consistency** (`shapes/index.test.ts`, extends
  existing): every key in `ADJUSTMENT_HANDLES` must exist in
  `PATH_BUILDERS` and `ADJUSTMENT_SPECS`. The 9 pilot kinds match
  exactly. After P3-A.2 this assertion grows to the full 33; the
  test does not need to know the exact target number, just the
  intersection rule.
- **Interaction tests** (`interactions/adjustment.test.ts`):
  - `hitAdjustmentHandle` returns the right `{elementId,
    handleIndex}` for hits, `null` for misses.
  - 2px drag threshold: 1px movement does not invoke
    `paintLiveAdjustments` or `store.updateElementData`; 3px does.
  - Rotated frame: when the element is rotated 30°, the world point
    of the handle is correctly computed and a hit at that world
    point resolves.
  - `snapToDefaults`: at default-equivalent within 5% of `(max-min)`,
    Shift snaps; at 10% it does not.
- **Editor integration** (`editor.test.ts`, extends existing):
  - Single selection of a pilot shape: handles are paint-listed.
    Multi-selection of two pilot shapes: handles are not paint-
    listed.
  - Drag end-to-end: pointerdown on handle → 5px move → pointerup
    invokes `store.batch` exactly once, with `data.adjustments` set,
    selection preserved.
  - Cancelled drag: pointerdown → pointerup at same coords (no
    threshold cross) → no `store` invocation, no undo entry.
- **Visual harness scenario** (`packages/frontend/src/app/harness/
  visual/slides-scenarios.tsx`): new scenario
  `shapes-adjustments-pilot` — 9 pilot shapes laid out in 2 rows ×
  9 columns, top row at default `adjustments`, bottom row at
  user-authored values that visibly differ (e.g. `roundRect` with
  near-50% radius, `star8` with 60000 inner ratio, callout with
  tail at corner). Baseline regen: `pnpm
  verify:browser:docker:update`.
- **Regression guard**: existing P1/P2 visual scenarios remain
  unchanged. Path builders themselves are untouched in P3-A.1
  (handles read the same `adjustments` array; geometry is derived
  identically).

### 6. File layout (additions / changes)

```text
packages/slides/src/view/canvas/shapes/
├── builder.ts                              # +Point, +AdjustmentHandle types
├── index.ts                                # +ADJUSTMENT_HANDLES + 9 .set() calls
├── basic/
│   ├── round-rect.ts                       # +ROUND_RECT_HANDLES
│   └── round-rect.handles.test.ts          # NEW
├── arrows/
│   ├── chevron.ts                          # +CHEVRON_HANDLES
│   └── chevron.handles.test.ts             # NEW
├── callouts/
│   ├── wedge-rect-callout.ts               # +WEDGE_RECT_CALLOUT_HANDLES
│   └── wedge-rect-callout.handles.test.ts  # NEW
└── stars/
    ├── star4.ts ... star10.ts              # +STAR_N_HANDLES (each)
    └── star4.handles.test.ts ... star10.handles.test.ts  # NEW (each)

packages/slides/src/view/editor/
├── interactions/
│   ├── adjustment.ts                       # NEW: hit, snap, defaultAdjustmentsFor
│   └── adjustment.test.ts                  # NEW
└── editor.ts                               # +startAdjustmentDrag,
                                            # +paintAdjustmentHandles,
                                            # hit-test wiring (after resize),
                                            # tooltip DOM lifecycle

packages/frontend/src/app/harness/visual/
└── slides-scenarios.tsx                    # +shapes-adjustments-pilot

docs/design/slides/
└── slides-shapes-p3a-adjustments.md        # this file
docs/design/README.md                       # +link in Slides table

docs/tasks/active/
├── 20260510-slides-shapes-p3a-pilot-todo.md     # NEW
└── 20260510-slides-shapes-p3a-pilot-lessons.md  # NEW (filled at task close)
```

Files added: ~16 (9 handle test files + handles in 9 shape files +
1 interaction module + 1 interaction test + 1 visual harness +
2 task docs + 1 design doc + 1 README link). Files modified: ~3
(`builder.ts`, `shapes/index.ts`, `editor.ts`).

Per-shape additions are localized: each pilot shape file gets a
`STAR_N_HANDLES`/`*_HANDLES` constant and one new test file.
Reviewers can read shape-by-shape independently.

### 7. Migration & backwards compatibility

- **Yorkie schema**: `data.adjustments` already exists; P3-A.1 adds
  no new fields. No version bump; no migration runs.
- **Renderer**: existing 55 shapes render bit-identical when
  `data.adjustments` is undefined or unchanged. `roundRect`,
  `chevron`, `wedgeRectCallout`, and the 6 stars get an additional
  diamond handle painted on top when single-selected — no change to
  the shape silhouette itself.
- **Picker**: untouched. P3-A.1 adds zero new shapes.
- **`InsertKind`**: untouched. Insertion still uses defaults.
- **CLI / PPTX**: no changes. The `adjustments` field round-trips
  through the existing `data` JSON path.

## Risks and Mitigation

### Risk: Handle position collides with resize handles

`roundRect` at `r = 0` puts the corner-radius handle exactly on the
top-left corner, where the NW resize handle lives. Same risk for
`wedgeRectCallout` if the user drags the tail to corner positions.

**Mitigation**: `position` functions enforce an 8px element-local
inset guard near edges and corners — the diamond never paints
closer than 8px to a resize handle. The underlying `adjustments`
data still reaches the boundary value (the *guard* only affects
where the diamond is drawn, not what value it represents). Hit
priority for adjustment handles further protects the case where
they do collide.

### Risk: Rotation transform forgotten in one path

Element-local coords are the contract, but the editor must apply
the rotation on paint and inverse-rotate on hit-test. A missed
transform produces wildly wrong handle positions on rotated shapes.

**Mitigation**: dedicated unit case in `interactions/adjustment.test.ts`
for a 30°-rotated star (handle world position computed forward,
hit-test inverse, both must match). The visual harness scenario
includes one rotated example so visual regression catches paint-
side errors.

### Risk: `apply` non-invertibility produces drift on round-trip

A drag-set value, painted, then re-dragged should land in roughly
the same place. Floating-point error and clamping can break this.

**Mitigation**: round-trip unit tests for each shape inside the
clamp range; documented tolerance ±50 OOXML units (i.e. 0.05% of
full range), well below visual thresholds. Shapes with near-
boundary values are tested separately and acknowledged to lose
identity at the boundary by definition.

### Risk: Last-write-wins on concurrent drags

Two users dragging the same star's `adjustments[0]` simultaneously
both see live-paint locally; on `pointerup`, the second commit
overwrites the first. The first user's authored value is silently
lost.

**Mitigation**: this is the same model as concurrent `frame` resize
or `fill` change, both of which already ship. P3-A.1 adopts the
established LWW behavior. Future Phase-B work on adjustments might
introduce per-index OT, but that is out of scope.

### Risk: Tooltip overlay z-fights with other DOM overlays

The drag tooltip overlaps any DOM-rendered editor overlays
(layout pickers, theme picker, comment threads).

**Mitigation**: tooltip is mounted into the same overlay container
as resize-indicator labels; it inherits the existing z-index for
canvas-tracking overlays, which sits below dropdown menus. Because
it appears only during active drag (the user is holding the mouse
down), it cannot collide with menus that require a separate click
to open.

### Risk: Scope creep into P3-A.2 / P3-B

The temptation to "just add `triangle` since it's a one-liner" or
"just add the popover number-input as a tooltip extension" is high.

**Mitigation**: P3-A.1 is locked at 9 shapes covering 4 axis types.
Any extra shapes get deferred to P3-A.2 (PR #N+1, mechanical
sweep). The number-input UI is tracked as a separate optional
follow-up; if Shift-snap + visible tooltip prove sufficient in
practice, the number input may be skipped entirely.

## Out-of-scope follow-ups (recorded for later phases)

| Phase | Item |
|---|---|
| P3-A.2 | Register `ADJUSTMENT_HANDLES` for the remaining 24 shapes (`triangle`, `parallelogram`, `trapezoid`, `hexagon`, `octagon`, `plus`, `donut`, `can`, 8 arrows, 3 other callouts, 6 equation shapes). Mechanical follow-up; no abstraction changes. |
| P3-A.3 | Optional: popover number-input fallback for users who prefer typed values. Reads / writes the same `data.adjustments`. |
| P3-B | +50 shapes for GS parity (extra callouts/arrows/banners + 12 action buttons); each new shape that has `AdjustmentSpec` entries also registers `AdjustmentHandle` entries in the same PR. |
| P3-C | Action button click handlers in presentation mode (depends on 5b-2). |
| P4 | DrawingML formula evaluator (AVList + guide formulas), enabling per-shape adjustments to come from PPTX `<a:avLst>` directly. |
| Selection | Path-precise hit-testing using `ctx.isPointInPath(path, x, y)`; particularly relevant for stars. Independent of P3-A. |
