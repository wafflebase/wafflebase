---
title: board
target-version: 0.6.2
---

<!-- Make sure to append document link in design README.md after creating the document. -->

# Board — Infinite Canvas

## Summary

A new document type `"board"` and package `@wafflebase/board` that provide a
Miro/FigJam-style **infinite canvas**: a boundless pan/zoom plane holding
free-position shapes, text boxes, and connectors, edited collaboratively in
real time.

The central insight from the codebase audit is that the `@wafflebase/slides`
**scene engine already works in a transform-agnostic "world" coordinate space**
(a 1920px-wide logical plane). The element model, the `drawElement` render loop,
hit-testing, snap, smart-guides, and group-transform math make **no screen
assumptions**. The only place a fixed slide frame is baked in is a single
uniform *fit-scale* used by exactly three chokepoints:

1. `drawSlide()` — `ctx.scale(fitScale)` render transform
   (`packages/slides/src/view/canvas/slide-renderer.ts`)
2. `editor.ts` — `scale()` + `clientToLogical()` pointer screen→world conversion
3. `overlay.ts` — `frame * scale` selection-handle placement

Swap that uniform fit-scale for a `{ panX, panY, zoom }` viewport matrix and the
entire scene engine reuses without a rewrite. This collapses the board's only
genuinely new risk to a single concern — the infinite viewport.

> **Framing:** *a board is one unbounded slide, viewed through a pan/zoom
> viewport.* The MVP does not fork or rewrite the scene engine; it makes the
> slides editor believe it is editing one "slide" whose `elements: Element[]`
> array is the infinite scene, while injecting a viewport transform in place of
> the fixed fit-scale.

This document specifies **SP1 (the canvas skeleton)**. Two follow-on
sub-projects (whiteboard elements, Miro import) are scoped at the end and get
their own spec → plan → implementation cycles.

### Goals

- New document type `"board"` end-to-end: create from the documents list, route
  to `/b/:id`, share, and collaborate — wired exactly like the recent `"note"`
  and `"slides"` types.
- New package `@wafflebase/board` as the home for board-specific logic
  (viewport, infinite-canvas view, board document model + Yorkie store).
- Infinite **pan/zoom viewport** with off-screen element culling.
- Reuse the slides scene engine (shapes / text boxes / connectors: create,
  move, resize, rotate, snap, smart-guides, select) **without forking
  `editor.ts`**, by injecting a viewport transform.
- Real-time collaboration via Yorkie (single plane, `board-<id>` docKey) plus
  peer presence — live peer **selection** rides `setPeers`. (Rendered
  peer-cursor dots are deferred to a follow-up; SP1 wires the presence channel
  but does not paint remote cursors.)
- **Regression gate:** slides behavior is byte-for-byte preserved — the existing
  slides import/export/round-trip/painter/interaction suites stay green
  (slides wraps its fit-scale as the *default viewport*).

Success = a `"board"` document can be created, opened, collaboratively edited
(add/move/resize/rotate a shape, text box, and connector) on an infinite
pan/zoom canvas with live peer selection presence, and `pnpm verify:self` stays
green with no change to slides behavior.

### Non-Goals (SP1)

- **Sticky notes, freehand drawing, image paste** — deferred to SP2; sticky
  notes and image paste/drop **have since shipped** (SP2, see
  [board-whiteboard-elements.md](board-whiteboard-elements.md)).
- **Miro import** — SP3 (structured import via the Miro REST API; see [board-miro-import.md](board-miro-import.md)).
- **Minimap, zoom-to-fit-all, presence viewport-follow** — nice-to-have
  follow-ups; the **minimap has since shipped** (SP2). Zoom-to-fit-all and
  presence viewport-follow remain unbuilt.
- **PPTX / PDF export, presentation mode** — slide-deck concepts, not board.
- **Layouts / masters / placeholders / speaker notes** — dropped from the board
  document model entirely.
- **Promoting the scene engine into `@wafflebase/core`** — the incremental
  strategy keeps board importing from slides in SP1; only the confirmed shared
  surface (the `Viewport` transform seam) is a candidate for later promotion.

## Proposal Details

### Architecture

```text
@wafflebase/board          NEW package — board-specific pure logic
  ├─ model/board.ts        board document model + single-slide deck synthesizer
  └─ view/viewport.ts      Viewport { panX, panY, zoom } + world↔screen ops + culling
        │  imports
        ▼
@wafflebase/slides         scene engine (element model, renderer, editor,
                           hit-test, snap, overlay, interactions) — REUSED
        │  imports
        ▼
@wafflebase/core           tokens / geometry / canvas / ooxml (existing plan)

packages/frontend/src/app/board/   the React mount + CRDT adapter (NOT the board package)
  ├─ board-detail.tsx      route shell (sidebar + header chrome) + DocumentProvider
  ├─ board-view.tsx        mounts the reused slides editor with the board Viewport
  ├─ board-toolbar.tsx     insert toolbar (Select / Text / Sticky ▾ / Image / Shape ▾ / Line ▾)
  └─ yorkie-board-store.ts YorkieBoardStore implements SlidesStore (single synthetic slide)
```

As with slides, the Yorkie adapter (`YorkieBoardStore`) and the editor mount
live in `packages/frontend`, not in the engine package — the `@wafflebase/board`
package stays pure (model + viewport math). SP1 did not add a
`view/board-editor` wrapper; `board-view.tsx` calls the slides `initializeEditor`
directly with the board viewport.

Per the chosen **incremental-extraction** strategy, board imports the scene
engine from `@wafflebase/slides` in SP1. The one shared surface this creates —
the `Viewport` transform seam — is the first candidate for promotion into
`@wafflebase/core/scene` once it has proven stable across both consumers. No
up-front engine extraction is attempted.

### The viewport seam (the only invasive change to slides)

Introduce a small shared surface, initially in slides, that all three
chokepoints route through:

```ts
interface Viewport {
  panX: number;   // screen px
  panY: number;   // screen px
  zoom: number;   // world px → screen px scale
}

// world→screen: sx = wx * zoom + panX ;  sy = wy * zoom + panY
function worldToScreen(v: Viewport, p: Point): Point;
function screenToWorld(v: Viewport, p: Point): Point;
```

Retrofit, behavior-preserving:

- **`drawSlide`** — replace the `ctx.scale(fitScale)` + pasteboard-translate
  block with `ctx.setTransform(zoom, 0, 0, zoom, panX, panY)`. Slides constructs
  its viewport from the existing fit-scale (`zoom = fitScale`, `pan =`
  pasteboard offset) so output is identical. Board passes its live viewport.
  The slide **background rect / bg-image** painting is skipped on a board
  (unbounded plane, no slide rectangle).
- **`editor.ts`** — `scale()` and `clientToLogical()` are replaced by a
  viewport provider. Slides supplies a fit-scale viewport; board supplies
  `{ panX, panY, zoom }`. Every pointer handler already funnels through
  `clientToLogical` and then works in world coordinates, so nothing downstream
  changes.
- **`overlay.ts`** — already takes `scale` as a parameter; pass `zoom`.

**Viewport culling:** before the `drawElement` loop, intersect each
`element.frame` (its rotated AABB — reuse slides' existing rotated-AABB helper
from `snap-candidates.ts`) against the screen's world-rect and skip
off-screen elements. Slides keeps culling disabled (fixed frame) to preserve
current paint behavior; board enables it.

**Board-only viewport interactions:** pan (space+drag / two-finger / wheel),
zoom (⌘/ctrl+wheel, pinch) about the cursor, and a zoom clamp. Zoom-to-fit-all
and minimap are deferred.

### Background grid

The board paints a Miro-style background grid so a user can tell where
they are on an unbounded plane, completing the set of orientation
affordances alongside the minimap (SP2) and the zoom readout (SP4).

It is a **CSS background on the canvas host**, not canvas paint.
Board-mode `drawSlide` only `clearRect`s — it deliberately paints no
slide-rect background (see the viewport seam above) — so the canvas is
already transparent and the host container's background shows through
under every element. Consequences:

- `@wafflebase/slides` is untouched: no renderer option, no editor option.
- Near-zero per-frame cost: four inline-style writes, against a canvas
  grid's full-viewport re-stroke every RAF tick. The compositor owns the
  painting.
- The grid cannot enter the minimap's rendered content, which snapshots
  through the same `drawSlide`. (The minimap PANEL is translucent, so the
  grid does composite faintly behind it — a chrome question, not a
  rendering one.)

`app/board/board-grid.ts` is the whole of it: a `gridStep(zoom)` ladder
(1-2-5 × 10^k, floored at 20 world units) that holds on-screen spacing in
`[20, 50)` px while zooming OUT — zooming in past 1× the floor takes over
and cells grow on screen instead (160 px at 8×), because the grid is a
fixed world-space distance reference — and `gridBackgroundStyle()`
mapping a `Viewport` to the `backgroundImage` / `backgroundSize` /
`backgroundPosition` triple — dot mode as one tile-centred
`radial-gradient` shifted half a cell onto the intersections, line mode as
four `linear-gradient` layers with majors every 5 cells painted over
minors. Offsets are wrapped into `[0, size)`, since a CSS background
repeats per tile and a Miro-imported board sits far from the world origin.

Mode (`none` / `dot` / `line`, default `dot`) is a **per-user view
preference in `localStorage`, not board state** — Miro models it the same
way, and one collaborator toggling a grid must not change anyone else's
view. The control is a `Grid ▾` dropdown next to Zoom in the board
toolbar; a read-only share-link visitor gets the grid but no toggle,
because `BoardView` hides the toolbar wholesale for viewers.

This also made `commitViewport` in `board-view.tsx` the single chokepoint
for pan/zoom: minimap-navigate, wheel, and space/middle-drag each used to
repeat the same `setViewport` + `repaintViewport` pair inline.

### Snap to grid

A second, independent toggle (Miro keeps them separate too): the mode
controls what is *drawn*, snap controls where things *land*, and
`Grid: None` + snap on is a real preference. Off by default, unlike the
display — drawing lines changes nothing about a board, while snapping
changes where every subsequent drag ends up, and a Miro-imported board's
elements sit at arbitrary coordinates that an on-by-default snap would
relocate the first time anyone nudged one.

The step is the **visible** grid — the same `gridStep(zoom)` the
background is painted from — so the user always lands on a line they can
see. Move and resize snap; connector endpoints and rotation do not.

Two additive `SlidesEditorOptions` carry it, and a slides mount passes
neither, so slides behavior is bit-identical:

```ts
getSnapGrid?: () => number | null;          // world step, null = off
hostCanvasMenuItems?: () => ContextMenuItem[];
```

`getSnapGrid` is a callback because the step depends on live zoom and the
editor is built once. `hostCanvasMenuItems` is the general form of the
bespoke `onFitToContent` hook — board-only menu entries should not each
earn an editor option — and carries the `Snap to grid` item that
right-clicking the empty canvas offers alongside the toolbar's checkbox.

Inside the editor the grid is a **fallback, not a candidate**. On each
axis, `snapDelta` runs its existing slide-centre / guide / element-edge
contest first, and only where nothing won inside the 8-unit threshold
does it quantize the bbox's left/top edge onto the lattice. Aligning to
another object is the stronger intent, and a grid that outranked edges
would make two shapes impossible to butt together unless their sizes
happened to be multiples of the step. Resize goes through
`quantizeResizeFrame` (`slides/view/editor/grid-snap.ts`), which rounds
only the edges the dragged handle moves and leaves the anchor edge fixed.

Unlike edge snapping, grid snapping has **no threshold** — it rounds. The
nearest grid line is never more than half a step away, so reusing the
8-unit band would leave the toggle inert whenever the step grew past it
(at zoom 0.25 the step is 80 world units, so it would engage a fifth of
the time). It emits no `SnapGuide` either: the painted grid is its own
feedback, and a line drawn on every frame of every drag is noise.

Escape hatches, in the order a user reaches for them: hold **Alt/Option**
to suspend the grid for one gesture (Shift is already spent on axis lock
and aspect); an equal-size smart-guide match or a Shift-held aspect
resize suppresses it too, since both are more specific intents that
rounding would break. Rotated elements grid-snap on move but not on
resize — `frame.x/y/w/h` describe the pre-rotation box, so its edges are
not the ones on screen and rounding them would align the shape to
nothing.

### Data model & Yorkie store

Board reuses slides' `Element` union and `YorkieElement` verbatim. It drops the
slide-frame concepts (layout / master / placeholder / notes / transition /
animations) and the multi-slide dimension.

```ts
// packages/frontend/src/types/board-document.ts
interface YorkieBoardRoot {
  meta: { title: string; unit?: 'in' | 'cm'; recentColors?: string[] };
  elements: YorkieElement[];   // the infinite-plane scene (slides' YorkieElement)
}
// docKey: `board-<id>`   (yorkie-doc-key.ts prefix map)
```

- **`YorkieBoardStore implements SlidesStore`** (in
  `packages/frontend/src/app/board/`) — the reused editor talks to a
  `SlidesStore`, whose every method is keyed by `slideId`. Board satisfies this
  interface with a **single synthetic slide** (`slideId === "board"`): the store
  ignores the `slideId` argument and operates on the one `elements` array.
  This is what lets the editor be reused unmodified.
- Reuse the slides store's proven patterns **verbatim**: `batch(fn)` →
  one `doc.update` = one undo unit; the `withUpdate` ambient-root mechanism;
  element-array CRDT moves (`moveAfter`/`moveFront`) to preserve identity on
  reorder; remote changes via `doc.subscribe`.
- **Text bodies** are stored as `data.blocks: Block[]` JSON exactly as slides
  does today (the docs rich-text engine is reused for text-box editing); the
  known "`yorkie.Tree` doesn't nest in array elements" limitation is inherited,
  not solved here.
- **Viewport and cursors are presence, not root** — pan/zoom is view-local and
  never touches the CRDT document; peer presence cursors ride the same channel
  slides already uses. `BoardPresence` (in
  `packages/frontend/src/types/board-document.ts`) already carries a world-coords
  `cursor` field, but as of SP1 the client neither publishes it nor paints remote
  cursor dots — that remains a deferred follow-up.

### Document-type wiring (traced from `"note"` / `"slides"`)

Backend is largely type-agnostic (a free-form `String` column) — no Prisma
migration, no `document.service.ts` change.

**Frontend**
- `types/documents.ts` — add `"board"` to the `DocumentType` union.
- `types/board-document.ts` — **new**: `YorkieBoardRoot`, `initialBoardRoot()`,
  presence type.
- `App.tsx` — lazy `BoardDetail` + `<Route path="/b/:id" …>`.
- `app/documents/document-list-utils.ts` — `getDocumentPath()` → `/b/:id`.
- `app/documents/document-list.tsx` — `TYPE_META` entry (label/icon/color) +
  "New Board" in both New dropdowns (main toolbar + empty-state).
- `app/shared/shared-document.tsx` — two switch sites (docKey builder + render
  switch), plus a `SharedBoardLayout` and lazy view import.
- `api/share-links.ts` — add `"board"` to the inlined `ResolvedShareLink.type`
  union.
- **new** `app/board/board-detail.tsx` (mirror `notes/notes-detail.tsx`) +
  `app/board/yorkie-board-store.ts`.

**Backend**
- `document/document.dto.ts` — add `"board"` to `DOCUMENT_TYPES` (else create
  400s).
- `yorkie/yorkie-doc-key.ts` — add `board: 'board-'` to the prefix map + switch
  (drives auth-webhook + event-webhook docKey parsing automatically).
- `api/v1/documents.controller.ts:54` — add `'board'` to the create allow-list
  (else v1 create silently falls back to `sheet`).

### SP1 commit staging (regression risk isolation)

1. **Viewport parameterization in slides** — introduce `Viewport` +
   `world↔screen`; route the three chokepoints through it; slides constructs a
   fit-scale viewport so behavior is unchanged. Gate: the full slides suite
   stays green.
2. **`@wafflebase/board` scaffold** — package, `board-document` types,
   `YorkieBoardStore` (single-slide `SlidesStore` adapter), `Viewport` view
   module + culling.
3. **Board view + editor wiring** — `board-detail.tsx` mounts the slides editor
   with the board viewport; pan/zoom interactions; presence cursors.
4. **Document-type wiring** — the frontend/backend checklist above; create,
   route, share.

### Sub-project decomposition

| # | Sub-project | Scope |
| --- | --- | --- |
| **SP1** (this doc) | Canvas skeleton | viewport seam + board package/type/store + collaborative canvas |
| SP2 ([spec](board-whiteboard-elements.md)) | Whiteboard elements | sticky notes (preset shape), image paste/drop, minimap |
| SP3 ([spec](board-miro-import.md)) | Miro import | Miro REST v2 client (one-shot pasted token, backend-only) → structured import of stickies/shapes/text/connectors/images + best-effort frames/cards into a new board |

### Risks and Mitigation

- **Slides is the highest-blast-radius consumer of the retrofitted transform.**
  *Mitigation:* the viewport change is behavior-preserving (slides = fit-scale
  viewport); the existing slides import/export/round-trip/painter/interaction
  suites are the merge gate on commit-stage 1, before any board code exists.
- **`editor.ts` is a ~6.7k-line controller.** Forking it would be unmaintainable.
  *Mitigation:* the single-synthetic-slide `SlidesStore` adapter + viewport
  injection reuse it unmodified; SP1 adds no editor fork.
- **Unbounded element counts hurt paint/hit-test.** *Mitigation:* viewport
  culling in SP1; spatial-index (quadtree) deferred until a real perf ceiling is
  hit (log, don't silently cap).
- **Text-in-array CRDT limitation** is inherited from slides. *Mitigation:*
  accept parity with slides for SP1; the contemplated `root.textTrees` map is a
  cross-cutting follow-up for both engines, not board-specific.
- **Over-extraction into core.** *Mitigation:* SP1 promotes nothing to
  `@wafflebase/core`; board imports from slides. Promote the `Viewport` seam only
  after it is proven across both consumers.
