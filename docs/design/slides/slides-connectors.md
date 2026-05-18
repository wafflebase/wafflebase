---
title: slides-connectors
target-version: 0.4.1
---

# Slides Connectors — Endpoint-Driven Lines with Connection Points

## Summary

Replace the bbox-based `line` / `arrow` shape kinds with a new
`Connector` element type whose geometry is defined by two endpoints,
either free coordinates or attached to a specific connection site on
another element. Add a connection-sites registry so each shape kind
exposes the same per-shape anchor points Google Slides offers, plus
auto-routed elbow and curved variants with a single optional manual
bend. The result is parity with the four Google Slides connector tools
(Line, Arrow, Elbow connector, Curved connector) backed by a clean,
endpoint-first data model.

### Goals

- One new element `type: 'connector'` covering Line, Arrow, Elbow, and
  Curved variants with a single `routing` field plus per-endpoint
  arrowheads (instead of `kind: 'line'` / `'arrow'` shapes).
- Per-shape connection sites with sensible 4-direction defaults and a
  registry of per-`ShapeKind` overrides for the cases where N/E/S/W
  midpoints don't describe the natural anchor points (triangle,
  diamond, star, callouts, etc.).
- Attached endpoints follow source moves, resizes, and rotations
  without explicit cache, by re-deriving world coordinates from the
  shape + site index each frame.
- Auto-routed elbow / curved connectors driven purely by endpoint
  positions and exit directions; optional `elbowBend` field that only
  persists when the user manually drags the elbow handle.
- Insertion and endpoint-drag UX that mirrors Google Slides: hover a
  shape during draw → connection points appear → snap within 12px →
  release to attach (or release in empty space for a free endpoint).

### Non-Goals

- **Multi-point paths** — Curve, Polyline, Scribble are deferred to a
  follow-up design. Their data model is fundamentally different (path
  point list, no endpoint snap) and they don't share the routing
  pipeline.
- **Obstacle avoidance / smart suggest.** Connectors pass through other
  shapes; Google Slides does the same. No auto-pathfinding.
- **Multi-bend elbow editing.** Exactly one user-adjustable bend per
  elbow connector, matching Google Slides.
- **DOCX / PPTX import-export round-trip for connectors.** Tracked
  separately under `slides-themes-layouts-import` follow-ups.
- **Yorkie schema migration.** Yorkie-backed `YorkieSlidesStore` ships
  in this PR; the connector data path resolves through `read()` and the
  new connector-mutation methods (`updateConnectorEndpoint`,
  `updateConnectorArrowheads`), plus cascade sweep on element removal
  and dependent-frame recompute on source moves.
- **Backwards compatibility with the existing `kind: 'line'` /
  `'arrow'` shapes.** v0.1.0 alpha, no persisted user data to migrate
  — `ShapeKind` drops both values; any in-memory authored content is
  recreated.

## Proposal Details

### 1. Element Model

A new sibling of `ShapeElement`, `TextElement`, `ImageElement`,
`TableElement`, `ChartElement` in the slide element union:

```ts
// packages/slides/src/model/connector.ts

export type Endpoint =
  | { kind: 'free'; x: number; y: number }
  | { kind: 'attached'; elementId: string; siteIndex: number };

export type ConnectorRouting = 'straight' | 'elbow' | 'curved';

export type ArrowheadKind =
  | 'triangle' | 'triangle-open'
  | 'diamond'  | 'diamond-open'
  | 'circle'   | 'circle-open'
  | 'square'   | 'square-open';

export type ArrowheadStyle = {
  kind: ArrowheadKind;
  size: 'sm' | 'md' | 'lg';
};

export type ConnectorElement = ElementBase & {
  type: 'connector';
  routing: ConnectorRouting;
  start: Endpoint;
  end: Endpoint;
  arrowheads: { start?: ArrowheadStyle; end?: ArrowheadStyle };
  stroke?: ShapeStroke;
  elbowBend?: number;  // [0, 1]; only present when user manually adjusted
};
```

`ElementBase` (`id`, `z`, `opacity`, …) is shared. There is no `frame`
field — the bbox is derived from the endpoints at render time, used
only for selection hit-testing and `Cmd+A` selection.

`ShapeKind` drops `'line'` and `'arrow'`. The path-builder dispatcher's
special-cased `drawLine` / `drawArrow` branches are removed from
`shape-special.ts`.

The "Line" tool and "Arrow" tool produce the same `ConnectorElement`
shape — Arrow simply pre-fills `arrowheads.end = { kind: 'triangle',
size: 'md' }`. Format menu toggles arrowheads independently per
endpoint.

### 2. Connection Sites

```ts
// packages/slides/src/model/connection-site.ts
export type ConnectionSite = {
  x: number;     // [0, 1] in local bbox (pre-rotation)
  y: number;     // [0, 1] in local bbox (pre-rotation)
  angle: number; // radians; outward normal in local coords (pre-rotation)
};
```

`angle` follows the canvas convention: `0 = +x` (right), `π/2 = +y`
(down). Helper constants `DIR_N = -Math.PI / 2`, `DIR_E = 0`, `DIR_S =
Math.PI / 2`, `DIR_W = Math.PI`.

**Registry** (`view/canvas/connection-sites/`):

```text
index.ts       getConnectionSites(element): ConnectionSite[]
defaults.ts    fourCardinal(): ConnectionSite[]  // N/E/S/W midpoints
overrides.ts   CONNECTION_SITES: Map<ShapeKind, ConnectionSite[]>
```

Resolution order:
1. If `element.type !== 'shape'` → `fourCardinal()` (text, image,
   table, chart all share the default 4-point set).
2. If `element.data.kind` is in `CONNECTION_SITES` → use that override.
3. Otherwise → `fourCardinal()`.

Initial overrides target shapes whose 4-cardinal default is clearly
wrong: `triangle`, `rightTriangle`, `diamond`, `parallelogram`,
`trapezoid`, `pentagon`, `hexagon`, `octagon`, `star` family
(outer-vertex anchors only), basic callouts (anchor on tail tip plus
body cardinals). The full 100+ shape catalog reaches Google-Slides
parity through incremental override additions in PR3.

**World coordinate transform** (pure function in
`connection-sites/index.ts`):

```ts
export function siteWorldPos(
  el: { frame: Frame },
  site: ConnectionSite,
): { x: number; y: number; angle: number } {
  const lx = site.x * el.frame.w;
  const ly = site.y * el.frame.h;
  const cx = el.frame.w / 2;
  const cy = el.frame.h / 2;
  const cos = Math.cos(el.frame.rotation);
  const sin = Math.sin(el.frame.rotation);
  const rx = cos * (lx - cx) - sin * (ly - cy) + cx;
  const ry = sin * (lx - cx) + cos * (ly - cy) + cy;
  return {
    x: el.frame.x + rx,
    y: el.frame.y + ry,
    angle: site.angle + el.frame.rotation,
  };
}
```

This is called every render frame for any attached endpoint. No cache,
no stale coordinates, no CRDT divergence risk. The cost is negligible
(few attached endpoints per slide).

### 3. Routing

Three pure functions, no side effects, fully unit-testable:

```ts
// packages/slides/src/view/canvas/routing.ts
export type Point = { x: number; y: number };
export type SegmentPath = { points: Point[] };
export type BezierPath  = { p0: Point; c1: Point; c2: Point; p1: Point };

export function routeStraight(a: Point, b: Point): SegmentPath;

export function routeElbow(
  a: Point, aDir: number,
  b: Point, bDir: number,
  bend?: number,
): SegmentPath;

export function routeCurved(
  a: Point, aDir: number,
  b: Point, bDir: number,
): BezierPath;
```

**Straight**: trivial — `{ points: [a, b] }`.

**Elbow** (Manhattan routing):
1. Project unit vectors from `aDir` and `bDir` to nearest cardinal axis
   (so any free-endpoint angle resolves to N/E/S/W exit).
2. Classify the direction pair:
   - **Perpendicular** (e.g. East + South) → 1-bend L-shape. Corner at
     the intersection of the two exit rays.
   - **Parallel same** (e.g. East + East) → 2-bend Z-shape. Mid-bend
     position controlled by `bend` (default 0.5 of the axis component
     parallel to exit direction); the bend cuts perpendicular to the
     parallel exit axis.
   - **Parallel opposite** (e.g. East + West) → if there is overlap on
     the perpendicular axis, 2-bend Z. Otherwise 3-bend with mid
     segment running back the way it came.
3. `bend` (when set) overrides the default mid-segment ratio. Stored
   only when the user drags the elbow handle.

**Curved**: cubic bezier with auto control points.

```ts
const dist = euclideanDistance(a, b);
const k = dist / 3;
const c1 = { x: a.x + cos(aDir) * k, y: a.y + sin(aDir) * k };
const c2 = { x: b.x + cos(bDir) * k, y: b.y + sin(bDir) * k };
```

**Free endpoint exit direction**: when an endpoint is `kind: 'free'`,
its exit direction for routing is `atan2(other.y - self.y, other.x -
self.x)` — pointing at the opposite endpoint.

### 4. Rendering Pipeline

```text
view/canvas/
  connector-renderer.ts    Draws the resolved path (segments or bezier)
                           with the connector's stroke, then arrowheads.
  arrowhead-renderer.ts    Per-kind arrowhead path; positioned at endpoint,
                           rotated to align with the local path tangent.
```

Resolution sequence per frame (in `element-renderer.ts`):

```text
ConnectorElement
  → resolve start/end Endpoint → world Point + exit angle
     (free: use stored x/y; attached: siteWorldPos(targetElement, site))
  → routing function picks path
  → connector-renderer draws stroke
  → arrowhead-renderer draws start/end heads if defined
```

Selection bbox is computed from the path points (tight bbox of segments
or bezier sample), expanded by stroke width. Used for hit-testing and
selection rectangles.

### 5. Editor Interactions

```text
view/editor/
  interactions/
    insert-connector.ts            Connector-tool drag flow with snap.
    connector-endpoint-drag.ts     Selected-endpoint drag with snap +
                                   free/attached transitions.
    elbow-bend-drag.ts             Elbow yellow-diamond handle drag.
  overlays/
    connection-points-overlay.ts   DOM overlay of site dots during
                                   insert / endpoint-drag modes.
```

**Connection points overlay** runs as a DOM layer on top of the canvas
so the dot size stays pixel-constant under zoom and the dots receive
pointer events naturally for hover styling. Activates only when the
user is inside `insert-connector` or `connector-endpoint-drag` mode.

**Snap behavior** (pixel distances, screen-space, DPR-corrected):

| Distance | Behavior |
|---|---|
| pointer ↔ nearest shape ≤ 24px | Shape's connection points become visible |
| pointer ↔ nearest site ≤ 12px | Site visually emphasized (target preview) |
| Release inside 12px | Endpoint becomes `attached` to that site |
| Release outside 12px | Endpoint stays `free` at pointer position |

Only the nearest shape's sites are displayed at a time (prevents
visual noise when shapes overlap).

**Endpoint handles (selected connector)**:

| Endpoint state | Handle visual |
|---|---|
| `free`     | white-filled circle, blue stroke |
| `attached` | blue-filled circle, white center dot |

Dragging an `attached` endpoint outside the source shape's 24px
hover-distance immediately converts it to `free` at the cursor
position; the converse re-attaches.

**Elbow handle**: single yellow-diamond handle at the midpoint of the
longest non-endpoint segment. Dragging updates `elbowBend` in [0, 1]
along the perpendicular-to-exit axis. The drag rounds to the nearest
0.01 to keep CRDT payload tidy.

**Insertion flow** (single tool, four variants from toolbar):

1. User clicks `Line` / `Arrow` / `Elbow connector` / `Curved
   connector` in the shape picker (extending the existing picker
   dropdown).
2. Cursor enters insert mode. `connection-points-overlay` activates.
3. `mousedown`: if pointer is within 12px of a site → start endpoint
   is `attached`. Otherwise → `free` at cursor.
4. While dragging: live preview line, snap behavior identical to step
   3 for the end endpoint.
5. `mouseup`: end endpoint resolves same way as start. Drag distance
   below 4px cancels insertion (prevents accidental clicks).
6. After insertion, tool auto-returns to selection mode (matching
   existing shape-insertion behavior).

**Right-click menu** (selected connector):

- Routing: `Straight` / `Elbow` / `Curved` radio.
- Arrowhead start / Arrowhead end: `none` + 8 kinds, current marked.
- Stroke options (shared with existing shape menu).

**Keyboard**: `Delete` deletes; `Esc` clears selection. No special
shortcuts beyond the generic ones.

**Translating a selection** (body drag, arrow nudge, align,
distribute): routes through `commitTranslate` in
`interactions/drag.ts`, not `store.updateElementFrame`. For
connectors, free endpoints translate by `(dx, dy)` and attached
endpoints stay anchored — so a multi-select drag whose group includes
an attached connector and not its host produces a rubber-band: the
free side follows the cursor while the attached side stays pinned.
The store's `updateElementFrame` rejects connectors precisely to
prevent the derived cached frame from drifting out of sync with the
endpoints; `commitTranslate` is the only sanctioned write path for
"translate this element by `(dx, dy)`."

### 6. Store Layer

`SlidesStore` interface in `packages/slides/src/store/store.ts` gains:

```ts
addConnector(connector: ConnectorElement): void;
updateConnectorEndpoint(id: string, side: 'start' | 'end', endpoint: Endpoint): void;
updateConnectorRouting(id: string, routing: ConnectorRouting): void;
updateConnectorArrowheads(id: string, heads: { start?: ArrowheadStyle | null; end?: ArrowheadStyle | null }): void;
updateConnectorElbowBend(id: string, bend: number | undefined): void;
```

Existing `removeElement(id)` gains a pre-removal sweep: iterate every
connector on the same slide; if any endpoint is `attached` to the
to-be-removed element, replace it with a `free` endpoint at the
endpoint's current world position (`siteWorldPos` snapshot). This
implements the Q4 c1 policy — attached endpoint survives source
deletion as a free endpoint at its last visible position.

`MemSlidesStore` (`store/memory.ts`) implements all of the above
synchronously. The future Yorkie-backed implementation follows the
same surface. Undo/redo wraps each call as a transaction.

### 7. File Organization

```text
packages/slides/src/
├── model/
│   ├── connector.ts                       NEW — Connector types
│   ├── connection-site.ts                 NEW — ConnectionSite type
│   └── element.ts                         MODIFY — drop line/arrow from ShapeKind
├── view/canvas/
│   ├── connector-renderer.ts              NEW
│   ├── arrowhead-renderer.ts              NEW
│   ├── routing.ts                         NEW
│   ├── routing.test.ts                    NEW
│   ├── connection-sites/
│   │   ├── index.ts                       NEW
│   │   ├── defaults.ts                    NEW
│   │   ├── overrides.ts                   NEW
│   │   └── connection-sites.test.ts       NEW
│   ├── element-renderer.ts                MODIFY — dispatch connector
│   ├── shape-renderer.ts                  MODIFY — drop line/arrow branches
│   └── shape-special.ts                   MODIFY — drop drawLine/drawArrow
├── view/editor/
│   ├── interactions/
│   │   ├── insert-connector.ts            NEW
│   │   ├── connector-endpoint-drag.ts     NEW
│   │   ├── elbow-bend-drag.ts             NEW
│   │   └── insert.ts                      MODIFY — connector tool entries
│   └── overlays/
│       └── connection-points-overlay.ts   NEW
└── store/
    ├── store.ts                           MODIFY — add connector methods
    ├── memory.ts                          MODIFY — implement connector methods
    │                                              + removeElement sweep
    └── memory.test.ts                     MODIFY — connector store tests
```

### 8. Testing Strategy

**Unit tests (Vitest, in `packages/slides`):**

- `routing.test.ts`: 8 direction combinations × {1-bend, 2-bend Z,
  3-bend} elbow cases; curved control-point math; free-free edge cases
  (zero-length, collinear).
- `connection-sites.test.ts`: `siteWorldPos` round-trip under 0/90/180
  rotation; default 4-cardinal correctness; override resolution.
- `memory.test.ts`: connector CRUD; `removeElement` sweep converts
  attached endpoints to free at correct world position; undo restores
  attachment.
- `arrowhead-renderer.test.ts`: each `ArrowheadKind` produces the
  expected path (snapshot or anchor-point assertion).

**Integration tests:**

- Insert flow happy path: pick tool → drag from shape A site to shape
  B site → verify resulting connector has two attached endpoints with
  expected `(elementId, siteIndex)` pairs.
- Move attached shape: connector endpoint world position updates
  automatically; no store mutations on the connector itself.
- Resize / rotate attached shape: same.
- Delete attached shape: connector remains, endpoint becomes free at
  last-rendered world position.

**Visual tests (browser, `pnpm verify:browser:docker`):**

- Endpoint visual states (free vs attached) at rest and during drag.
- Elbow bend handle drag updates path.
- Snap UX: hover shape during draw shows sites; hover near site
  emphasizes; release-far falls back to free.

### 9. Phased Rollout

Three PRs sized for independent review and verification:

**PR1 — Foundation + Straight/Arrow** (`feat/slides-connectors-base`)
- `ConnectorElement`, `Endpoint`, `ArrowheadStyle`, `ConnectionSite`
  types.
- Default 4-cardinal connection sites only (no per-kind overrides yet).
- `routing.ts` with `routeStraight` only.
- `connector-renderer.ts`, `arrowhead-renderer.ts`.
- Store methods (`addConnector`, `updateConnectorEndpoint`,
  `updateConnectorArrowheads`, `removeElement` sweep).
- `insert-connector.ts` and `connector-endpoint-drag.ts` for Line +
  Arrow tools.
- `connection-points-overlay.ts`.
- Drop `kind: 'line'` and `kind: 'arrow'` from `ShapeKind` and remove
  the corresponding paint paths.

**PR2 — Elbow + Curved Routing**
  (`feat/slides-connectors-elbow-curved`)
- `routeElbow` and `routeCurved` in `routing.ts`.
- `elbow-bend-drag.ts` + `updateConnectorElbowBend` store method.
- Elbow + Curved tools in toolbar.
- Right-click menu: routing change.
- Per-`ShapeKind` overrides for the high-impact shapes
  (`triangle` / `diamond` / `parallelogram` / `trapezoid` /
  pentagon / hexagon / octagon / star outer vertices).

**PR3 — Polish + Coverage** (`feat/slides-connectors-polish`)
- Per-`ShapeKind` overrides for the remaining shapes (callouts, block
  arrows, flowchart shapes).
- Arrowhead kinds beyond `triangle`: open variants, diamond, circle,
  square, sm/md/lg sizes. Inspector panel section for arrowhead
  selection.
- A11y / keyboard polish (focus ring on endpoint handles, etc.).

## Risks and Mitigation

| Risk | Mitigation |
|---|---|
| Attached endpoint computation every frame becomes a hot path on busy slides. | The work is O(connectors), not O(elements). Slides with hundreds of connectors are unusual. If profiling shows a bottleneck, cache `siteWorldPos` results keyed on the source element's frame + rotation, invalidated when the source mutates. |
| Removing `kind: 'line'` / `'arrow'` from `ShapeKind` is a breaking change to public types. | v0.1.0 alpha; no published consumer of the type. Sweep usages in monorepo before PR1 lands. Document the rename in PR1 description. |
| Elbow routing algorithm produces awkward paths in edge cases (e.g. exit-direction angle ambiguity for free endpoints whose pair is at the same point). | Routing functions are pure and unit-tested; edge cases get explicit test coverage. Visual review during PR2 validates aesthetic correctness on real slides. |
| Connection-site override registry needs maintenance as more shapes adopt non-default anchors. | Default 4-cardinal works for ~70% of the catalog already; overrides are additive and can ship incrementally in PR3 and beyond without breaking existing slides. |
| Yorkie schema for the new element type needs to land for collaboration to work. | Yorkie-backed `YorkieSlidesStore` ships in this PR; the connector data path resolves through `read()` and the new connector-mutation methods, plus cascade sweep on element removal and dependent-frame recompute on source moves. |
| User rotates a source shape with an attached connector and the connector's path no longer makes sense (e.g. crosses through the shape). | Acceptable behavior — Google Slides behaves identically. Users reroute manually. |
