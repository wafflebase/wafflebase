# Slides — precise shape & connector hit-test

## Problem

Today every slides element is selected by its axis-aligned bounding
rect (`containsPoint` in `packages/slides/src/model/frame.ts:9`,
called from `interactions/select.ts:40` and
`view/editor/editor.ts:1854`).

That feels wrong in two ways:

1. **Filled shapes** — clicking the empty corners of an ellipse,
   diamond, star, etc. still selects them, even though the user
   visually clicked off the shape.
2. **Connectors (lines/arrows)** — far worse, because a long diagonal
   line has a huge bbox; large empty regions select the line.

## Goal

Selection should be based on the **drawn area**, with a small touch
tolerance for thin geometry.

- `ShapeElement` (filled / closed) — hit iff the point is inside the
  Path2D produced by the registered `PATH_BUILDERS` builder, in
  element-local coordinates (after un-rotation / un-flip).
- `ShapeElement` (stroke-only or `OPEN_PATH_KINDS` — brackets / braces
  / unfilled outlines) — hit iff the point is within
  `stroke.width / 2 + tolerance` of the path's polyline approximation.
- `ConnectorElement` — hit iff the point is within
  `stroke.width / 2 + tolerance` of the routed segments. Endpoints +
  arrowhead area count as hits.
- `TextElement` / `ImageElement` / action buttons — keep bbox hit
  (`containsPoint`). These are rectangular by intent.

Tolerance baseline: **6 px** at logical-slide coordinates (i.e. the
same coord space `selectAt` already takes). Mobile already passes a
larger handle tolerance separately — we will reuse the same per-shell
constant for the line tolerance.

## Plan

### 1. New module: `view/editor/hit-test/element-hit.ts`

Single entry point used by both `selectAt` and `editor.ts`:

```ts
hitTestElement(
  el: Element,
  px: number, py: number,           // world / slide-logical
  ctx: { isPointInPath: ... },      // 2d ctx, real or test shim
  opts?: { tolerance?: number; elements?: ReadonlyMap<string, Element> },
): boolean
```

- `text` / `image` → `containsPoint(el.frame, px, py)`.
- `shape` (action buttons) → `containsPoint` (special-cased renderer,
  always rectangular).
- `shape` (filled, registered in `PATH_BUILDERS`):
  - `local = toLocal(frame, {px, py})`.
  - Apply flip inverse: `lx = flipH ? w - local.x : local.x`,
    `ly = flipV ? h - local.y : local.y`.
  - Run `ctx.isPointInPath(path, lx, ly, fillRule)` where `fillRule`
    is `'evenodd'` for `EVENODD_KINDS` (currently `donut`) else
    `'nonzero'`.
- `shape` (no `data.fill` OR `OPEN_PATH_KINDS`):
  - Approximate the Path2D's outline as polyline segments and run
    `distanceToPolyline(local, segments)`; hit iff
    `<= stroke.width / 2 + tolerance`.
  - The path builders use a closed subset of Path2D ops (rect,
    ellipse, moveTo/lineTo, quadraticCurveTo, bezierCurveTo, arc) —
    same subset that `test-canvas-env.ts` already approximates. We
    will introduce a small `Path2D → polyline` extractor in the same
    module (NOT installed globally) by intercepting these ops through
    a recording Path2D wrapper. Builders take a `Path2D` constructor
    via the global, so we cannot intercept without re-running the
    builder against a recording shim.
  - Pragmatic v1: only run the stroke-distance branch for unfilled
    shapes (rare in real decks) and brackets/braces (handful of
    kinds). For brackets/braces we hard-code the polyline matching
    each builder's geometry — they are simple. For "stroke-only on a
    normally-filled shape" we fall back to the path's bbox (existing
    behaviour) and revisit if it becomes a complaint.
- `connector`:
  - Resolve endpoints via `resolveEndpoint`, route via `routeStraight`
    (today the only routing).
  - Returns `points: Point[]`. `hit = distanceToPolyline({px,py}, points)`
    `<= stroke.width / 2 + tolerance`.
  - Future routings (`elbow`, `curved` — currently unused) follow the
    same pattern once `routeElbow` / `routeCurved` land.

### 2. Wire it into the two `topmostUnderPoint` sites

- `packages/slides/src/view/editor/interactions/select.ts:38` —
  replace `containsPoint(...)` call with `hitTestElement(...)`.
  Take a 2d context + tolerance from the caller; `selectAt` grows a
  new options arg.
- `packages/slides/src/view/editor/editor.ts:854` — same. Both
  callsites in `editor.ts` (`onContextMenu`, `onPointerDown`,
  `onDoubleClick`) already have access to `this.renderer` / a canvas
  context. We will pass `this.options.canvas.getContext('2d')` (cached
  reference) and the editor's per-shell tolerance.

### 3. Tests

- `packages/slides/test/view/editor/interactions/select.test.ts` —
  extend with:
  - Click inside ellipse bbox but outside the ellipse → no hit.
  - Click on diamond's empty corner → no hit; click on its centre → hit.
  - Click on a rotated rect's bbox corner that lies outside the
    rotated rect → no hit.
  - Click on flipped shape (asymmetric, e.g. rightArrow) — hit/miss
    follow visual geometry after flip.
- New `packages/slides/test/view/editor/connector-hit.test.ts`:
  - Straight connector from (10,10) to (200,10), stroke width 2:
    point (100, 12) is a hit (within tolerance); (100, 30) is a miss.
  - Endpoint area is a hit.
  - Diagonal connector: a point far inside its bbox but far from the
    line is a miss.
- Existing `select.test.ts` rect-based tests stay green (rect uses
  `buildRect` — `isPointInPath` should agree with bbox for axis-
  aligned rects).
- Use `createTestCanvas` from `view/canvas/test-canvas-env.ts` —
  already has Path2D shim + `isPointInPath`.

### 4. Design note

Add a short section to `docs/design/slides/slides.md` (Hit testing) or
a new design doc — TBD after implementation. Decide based on size:
- < 1 page → fold into `slides.md`.
- otherwise → `docs/design/slides/slides-hit-test.md`.

## Out of scope

- New `EVENODD_KINDS` entries beyond `donut`. We will trust the
  renderer's existing list.
- Tolerance UI / configurability — single constant in editor for now.
- Elbow / curved connector routing (not implemented yet — see
  `routing.ts`).
- Reusing the precise hit-test for marquee / lasso selection. Lasso
  already uses bbox intersection; bbox is acceptable for marquee.

## Risks

- **Builder side-effects at hit-test time** — path builders are pure
  and cheap (no allocations beyond Path2D). Hit-test recomputes the
  Path2D per click; that is fine.
- **`isPointInPath` rounding on path boundaries** — tolerance of a
  pixel either side is acceptable for click; we will not pad the
  filled path. Tests pick interior / exterior points well clear of
  the boundary.
- **Open-path shapes other than brackets/braces** — if a normally
  filled shape has `fill: undefined` (stroke-only outline), the v1
  falls back to bbox. Document this in the design note. Real decks
  rarely render stroke-only ovals.

## Verification

- `pnpm test --filter @wafflebase/slides` green.
- `pnpm verify:fast` green.
- Manual smoke in `pnpm dev`:
  - Insert ellipse → click corners → no select. Click centre →
    selects.
  - Insert line connector → click off the line by 20px → no select.
    Click within 4px → selects.
  - Rotated rect → corner of bbox is dead, body selects.
