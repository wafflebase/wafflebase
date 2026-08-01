---
title: board-whiteboard-elements
target-version: 0.6.3
---

# Board — Whiteboard Elements (SP2)

## Summary

SP2 of the [board infinite canvas](board.md) adds the three whiteboard
affordances deferred from SP1: **sticky notes**, **image paste/drop**, and a
**minimap**. All three land as **board-local code only** — the
`@wafflebase/slides` scene engine (element model, renderer, editor, store
interface) is reused unchanged, and the Yorkie board document schema is
untouched.

The governing constraint from SP1 holds: *a board is one unbounded slide,
viewed through a pan/zoom viewport.* SP2 exploits that everything a whiteboard
needs already exists in the reused engine:

- A **sticky note is a preset shape** — a `roundRect` `ShapeElement` with a
  solid fill, drop shadow, and a middle-anchored shrink-autofit text body. Every
  field already exists on `ShapeElement.data`; no new element type, no slides
  model change.
- **Image paste** reuses the shipped upload pipeline (`uploadImageFile` →
  `POST /api/v1/workspaces/:wid/images` → `wafflebase-files` bucket) and the
  shipped clipboard/drag-drop handler `setupSlidesImagePaths`, both funneling to
  `insertImageOnSlide`.
- The **minimap** reuses `drawSlide` (whole-scene offscreen render),
  `combinedBoundingBox` (world bounds of all frames), and `screenToWorld`
  (viewport-rect overlay). It is pure view-local state — no CRDT, no presence.

## Goals / Non-Goals

### Goals

- **Sticky notes** — a board toolbar split-button (main = default color,
  chevron = 6-color palette) that drops a fixed-size sticky at the current
  viewport center, selected and ready to edit. Once placed it is an ordinary
  shape: move / resize / rotate / snap / smart-guide / collaborate for free.
- **Image paste** — clipboard paste **and** drag-drop of image files onto the
  board canvas, plus a toolbar Image button (file picker). Uploaded to the
  existing bucket, inserted as a slides `ImageElement` at a centered,
  aspect-capped frame.
- **Minimap** — a bottom-right overview of the whole scene with the current
  viewport drawn as a draggable rectangle; toggle button, on by default;
  present in read-only mode.
- **Regression gate:** slides behavior is byte-for-byte preserved. Because SP2
  adds **zero** slides model/engine changes, the slides suite is unaffected by
  construction; the board suite gains the new units.

Success = on a `"board"` document a user can drop a colored sticky and type in
it, paste/drag an image onto the canvas, and navigate via a minimap whose
viewport rectangle tracks and drives pan — all collaboratively for stickies and
images — with `pnpm verify:self` green.

### Non-Goals (SP2)

- **Freehand / pen drawing, connectors-to-sticky auto-attach, sticky "packs" /
  templates.** Not this pass.
- **Image hotlink-by-URL, image cropping entry from board** — the crop *model*
  rides along on the reused `ImageElement`, but no board crop UI is added.
- **Zoom-to-fit-all, presence viewport-follow** — still deferred (SP1
  non-goals). The minimap *drag* moves the viewport, but a one-click
  "fit all" button is out of scope.
- **A distinct `"sticky"` element type / PPTX sticky semantics** — a sticky is a
  preset shape; it round-trips as a `roundRect` shape, nothing more.
- **Miro import** — SP3.

## Proposal Details

### Architecture

```text
packages/frontend/src/app/board/     (all SP2 code lives here + board pkg)
  ├─ board-toolbar.tsx      + Sticky split-button, + Image button
  ├─ board-view.tsx         + mount setupSlidesImagePaths, + <BoardMinimap/>
  ├─ board-detail.tsx       pass uploadFn (uploadImageFile bound to workspaceId)
  ├─ sticky.ts        NEW   sticky color palette + buildStickyInit(color, center)
  ├─ board-minimap.tsx NEW  view-local overview overlay + viewport-rect drag
  └─ minimap-geometry.ts NEW  pure world↔minimap mapping + fitted transform

packages/board/src/view/viewport.ts  (reused; may gain a setViewport helper)
        │ imports
        ▼
@wafflebase/slides   REUSED unchanged:
  insert-image.ts (insertImageOnSlide), slides-image-input.ts (setupSlidesImagePaths),
  image-upload.ts (uploadImageFile), model/element.ts (ShapeElement/roundRect/Fill/
  DropShadow/TextBody), view/canvas/slide-renderer.ts (drawSlide),
  view/canvas/thumbnail.ts (renderThumbnail), model/frame.ts (combinedBoundingBox),
  view/canvas/viewport.ts (screenToWorld)
```

No new package, no new engine export beyond what slides already exports. The
board Yorkie store (`YorkieBoardStore`), the document type, and the schema are
unchanged from SP1.

### Sticky notes (preset shape)

A sticky is created by a **board-local factory**, not by extending the editor's
`InsertKind`. This keeps the slides editor untouched and matches the chosen
"preset shape" model.

**`sticky.ts`:**

```ts
// 6 Google-Keep / Miro-adjacent pastel fills; text stays dark for contrast.
export const STICKY_COLORS: { name: string; value: string }[] = [
  { name: 'Yellow', value: '#FFF8B8' }, { name: 'Green', value: '#CDEFC4' },
  { name: 'Blue',   value: '#C7E5FF' }, { name: 'Pink',   value: '#FFD6E7' },
  { name: 'Orange', value: '#FFE0B2' }, { name: 'Purple', value: '#E5D4FF' },
];
export const STICKY_SIZE = 180; // world px, square

// Returns an ElementInit for store.addElement(SYNTHETIC_SLIDE_ID, init).
export function buildStickyInit(colorValue: string, center: Point): ElementInit;
```

`buildStickyInit` returns:

```ts
{ type: 'shape',
  frame: { x: center.x - STICKY_SIZE/2, y: center.y - STICKY_SIZE/2,
           w: STICKY_SIZE, h: STICKY_SIZE, rotation: 0 },
  data: {
    kind: 'roundRect',
    fill: { kind: 'srgb', value: colorValue },
    stroke: { /* none / very light */ },
    effects: { shadow: { color: '#000000', opacity: 0.18, angle: 90, distance: 3, blur: 8 } },
    text: { blocks: [/* single empty, center-aligned paragraph */],
            verticalAnchor: 'middle', autofit: 'shrink' },
  } }
```

**Placement flow (board-local):**
1. Toolbar Sticky button → on color pick, board-view reads the current viewport
   and computes `center = screenToWorld(vp, { x: hostWidth/2, y: hostHeight/2 })`.
2. `store.batch(() => id = store.addElement(SYNTHETIC_SLIDE_ID, buildStickyInit(color, center)))`
   — one undo unit, one CRDT change.
3. Select the new element (`editor.select(id)` / the editor's existing
   select-by-id path). Text edit is entered by the existing double-click
   gesture; **if** the reused editor exposes a begin-text-edit API for an id, we
   call it for immediate typing (best-effort — verified against the editor
   surface during implementation, not assumed).

Because the result is a plain `ShapeElement`, all downstream behavior (move,
resize with autofit reflow, rotate, snap, smart-guides, group, remote sync,
undo) is inherited with zero new code. The 6-color palette also serves as a
recolor affordance later, but SP2 only wires **insert**.

### Image paste / drop / file-picker

Three entry points, all funneling to the shipped `insertImageOnSlide`:

- **Paste + drag-drop:** in `board-view.tsx`, after the editor mounts, call
  `setupSlidesImagePaths({ wrapper, editor, store, slideId: SYNTHETIC_SLIDE_ID, upload })`
  (the same setup slides uses) and dispose it on unmount. It installs
  `dragenter/dragover/drop` on the canvas wrapper and `paste` on `document`,
  gated on `editor.getEditingElementId() === null` and `isPasteOwnedElsewhere()`
  — so pasting into a sticky's text still goes to the text, not the canvas.
- **Toolbar Image button:** opens a hidden file input; on file, calls
  `insertImageOnSlide({ store, slideId: SYNTHETIC_SLIDE_ID, file, upload })`.
  Omitted entirely when `readOnly`.

`upload` is built in `board-detail.tsx` from the workspace it already has:
`const upload = (file) => uploadImageFile(file, workspaceId)`. Insert position:
`insertImageOnSlide` centers within a logical height; on a board we center on the
current viewport (pass the viewport-center world point through
`InsertImageArgs`, mirroring the sticky center computation) so the image lands
on-screen rather than at world origin.

> **`insertImageOnSlide` centering:** it currently frames against a fixed
> `slideHeight`. Board passes the on-screen world center + a viewport-derived
> max size. If the existing signature can't express "center here," we thread an
> optional `center?: Point` param through `InsertImageArgs` — an additive,
> board-driven, slides-back-compatible change (default = today's behavior).

### Minimap (view-local)

`board-minimap.tsx` renders a small fixed overlay (bottom-right, e.g.
200×150 px) containing a downscaled snapshot of the whole scene plus the current
viewport rectangle.

**Geometry (`minimap-geometry.ts`, pure + unit-tested):**
- `sceneBounds = combinedBoundingBox(elements.map(e => e.frame))` — the world
  AABB of everything (padded by a margin). `undefined` when the board is empty.
- `fit(sceneBounds, minimapSize)` → a `{ scale, offsetX, offsetY }` that maps
  world → minimap px (letterboxed to preserve aspect).
- `viewportRectInMinimap(vp, hostSize, fit)` — the on-screen world rect
  (`screenToWorld` of the two host corners) mapped into minimap px.
- Inverse `minimapPointToWorld(px, fit)` for drag-to-pan.

**Rendering:** draw the scene into a small offscreen canvas via `drawSlide` /
`renderThumbnail` with a viewport constructed from `fit` (`zoom = scale`,
`pan = offset`), `cull: false`, `suppressSlideChrome`-equivalent (no slide
rectangle). Repaint is coalesced (reuse `ThumbnailScheduler` or a rAF debounce)
and triggered on element change + a low-frequency tick; the viewport rectangle
overlay repaints on every pan/zoom (cheap).

**Interaction:** dragging inside the minimap recenters the board viewport
(`minimapPointToWorld` → set `vp.panX/panY` so that world point is at host
center → `editor.setViewport` + `editor.render`). A **toggle button** (on by
default) collapses it to a small chevron. Empty board (`sceneBounds ===
undefined`) → minimap hidden or shows an empty placeholder. Shown in read-only.

### Data model & collaboration

- **Stickies and images** are ordinary elements written through the existing
  `YorkieBoardStore.addElement` path → same CRDT change, same `batch()` undo
  unit, same remote-subscribe repaint as any SP1 shape. **No schema change,
  no new presence field.**
- **Minimap + viewport** are strictly view-local (as in SP1): pan/zoom never
  touches the document; the minimap reads `model.elements` + the live viewport.

### Testing

- `sticky.test.ts` — `buildStickyInit` produces a `roundRect` shape with the
  right fill/shadow/middle-anchor/shrink-autofit and a frame centered on the
  given point; palette has 6 distinct colors.
- `minimap-geometry.test.ts` — `fit` letterboxing (wide vs tall scenes),
  round-trip `minimapPointToWorld(worldToMinimap(p)) ≈ p`, viewport-rect mapping
  for a known viewport, empty-scene `undefined`.
- Image wiring — a board smoke test that a mocked `upload` + `insertImageOnSlide`
  adds one `image` element via the board store (the slides paste/drop internals
  are already covered in the slides suite; board only tests the wiring).
- Slides regression — unaffected by construction (no slides source touched
  except the additive `center?` param, whose default preserves current
  framing; the slides suite covers the default path).

## Risks and Mitigation

- **Auto-enter-text-edit on sticky create may not have a clean editor API.**
  *Mitigation:* the sticky is created *selected*; immediate typing is
  best-effort. If no begin-edit-by-id API exists, ship with double-click-to-edit
  (parity with every other shape) and note it — do not fork the editor to force
  it.
- **`insertImageOnSlide` centers against a fixed slide height.** *Mitigation:*
  thread an additive optional `center?` through `InsertImageArgs`, default
  = today's behavior, so slides is untouched and board lands images on-screen.
- **Minimap repaint cost on large/animated boards.** *Mitigation:* coalesce
  scene snapshots (scheduler/rAF), repaint the cheap viewport-rect overlay
  independently; the snapshot is at thumbnail resolution. Spatial index still
  deferred (log, don't cap) — consistent with SP1.
- **Paste routing ambiguity (canvas vs sticky text).** *Mitigation:* reuse
  slides' existing `getEditingElementId()` / `isPasteOwnedElsewhere()` gating
  verbatim; do not reimplement paste routing.
- **Scope creep into a first-class sticky type.** *Mitigation:* SP2 explicitly
  ships stickies as preset `roundRect` shapes; recolor UI, sticky templates, and
  connector auto-attach are out of scope.
