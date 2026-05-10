---
title: slides
target-version: 0.4.0
---

# Slides Package

## Summary

The `@wafflebase/slides` package adds a Google-Slides-style presentation
engine to the Wafflebase monorepo, alongside the existing `sheets` and
`docs` packages. A presentation is a sequence of slides; each slide is a
free-position canvas containing text boxes, images, and basic shapes.
Real-time collaboration uses Yorkie CRDTs (one document per
presentation), matching the conventions established by `sheets` and
`docs`. Text inside text boxes reuses the rich-text engine from
`@wafflebase/docs`. PDF export reuses the docs PDF pipeline.

This document covers the v1 (MVP) scope. Larger items (animations,
themes, PPTX, embedded sheet ranges, comments, lazy per-slide
documents) are explicitly out of scope and listed at the end.

### Goals

- Add a self-contained slides engine that can run with any `SlidesStore`
  implementation (in-memory for tests/CLI, Yorkie-backed for the app).
- Support free-position editing of text boxes, images, and basic shapes
  (rectangle, ellipse, line, arrow) inside a fixed-size logical canvas.
- Provide layout templates (title, title + body, blank) so new slides
  start from sensible defaults.
- Render through Canvas with a DOM overlay for selection handles and
  text editing — consistent with `sheets`/`docs`.
- Support real-time collaboration via Yorkie, including peer cursor
  labels and stable selection across remote structural edits, reusing
  patterns from `sheets/peer-cursor-labels` and
  `sheets/axis-id-selection`.
- Provide a full-screen presentation mode with keyboard navigation.
- Export to PDF using the same `pdf-lib` + Noto KR pipeline as docs.
- Reuse `@wafflebase/docs` rich text inside text boxes (font, color,
  alignment, lists, IME) without re-implementing.
- Cover the keyboard and editing affordances a Google Slides user
  expects on day one: slide duplicate, element copy/paste/cut, arrow-key
  nudging, z-order shortcuts, lasso select, right-click context menu,
  multi-slide selection, and per-slide speaker notes.

### Non-Goals (v1)

- Animations, slide transitions (including simple fade — adding even
  one transition forces the underlying transition system).
- Global theme system and master slides (only per-slide background fill
  in v1; layouts are a fixed code-defined set, see "Layouts").
- PPTX import/export (PDF only). PPTX export is a likely v2 ask given
  ecosystem lock-in concerns.
- Embedded sheets, ranges, charts.
- Comments, suggestions, version history.
- Mobile zoom-to-fit (the docs equivalent can be ported in v2).
- Per-slide Yorkie documents and lazy loading. v1 assumes a single
  Yorkie document per presentation. Re-evaluate when presentations
  routinely exceed ~100 slides.
- Right-side "Format options" panel (drop shadow, reflection, precise
  numeric inputs). v1 surfaces all editable properties through the top
  contextual toolbar; what is not in the toolbar is not in v1.
- Slide- or element-level REST API endpoints. The existing
  `/api/v1/.../documents` metadata endpoints work with `type: 'slides'`
  unchanged; finer-grained endpoints can be added later if external
  automation demand appears.

#### Deferred to v1.1 (in scope, just not the first cut)

- Hyperlinks on shapes and images (text-box hyperlinks come for free
  with the docs engine in v1).

#### Deferred to v2

- Group / ungroup (Cmd+⌥+G). Requires a new element kind or a `groupId`
  attribute that ripples through selection, drag, hit-testing, and
  Yorkie schema; too costly for the first release.
- Speaker-notes presenter window (the data model and per-slide editor
  panel are in v1; the "presenter view" with notes on a second screen
  is v2).
- All other Google-Slides parity items not covered above (see "Future
  parity with Google Slides" at the end of this document).

## Proposal Details

### Package layout

`@wafflebase/slides` is a pure domain library with no dependency on
Yorkie or React, mirroring how `sheets` and `docs` are structured. The
Yorkie adapter and the React UI live in `frontend`, alongside the
existing `app/spreadsheet/yorkie-store.ts` and
`app/docs/yorkie-doc-store.ts`.

```
packages/slides/                     # domain library
└── src/
    ├── index.ts
    ├── model/
    │   ├── presentation.ts          # SlidesDocument, Slide
    │   ├── element.ts               # TextElement, ImageElement, ShapeElement
    │   ├── frame.ts                 # x/y/w/h/rotation math, hit-testing
    │   └── layout.ts                # Layout templates
    ├── store/
    │   ├── store.ts                 # SlidesStore interface
    │   └── memory.ts                # MemSlidesStore
    ├── view/
    │   ├── canvas/
    │   │   ├── slide-renderer.ts
    │   │   ├── element-renderer.ts
    │   │   └── thumbnail.ts
    │   ├── editor/
    │   │   ├── editor.ts            # controller
    │   │   ├── selection.ts
    │   │   ├── interactions/        # drag, resize, rotate, drag-add
    │   │   └── text-bridge.ts       # bridge to docs IME / contenteditable
    │   └── present/
    │       └── presenter.ts
    └── export/
        └── pdf.ts                   # delegates font/embedding to docs

packages/frontend/src/app/slides/    # Yorkie + React shell
├── yorkie-slides-store.ts           # Yorkie ↔ SlidesStore adapter
├── slides-view.tsx                  # routed page entry
├── editor-shell.tsx                 # 2-pane layout + top toolbar
├── thumbnail-panel.tsx
├── contextual-toolbar.tsx           # selection-driven top toolbar
└── presentation-mode.tsx
```

Module responsibilities:

- `model` — pure data and coordinate math; no Yorkie, no DOM.
- `store` — single entry point for state mutations; the interface lets
  `MemSlidesStore` and `YorkieSlidesStore` be swapped freely.
- `view/canvas` — drawing only; no input handling.
- `view/editor` — input, selection, drag/resize/rotate; calls the store.
- `view/present` — read-only fullscreen renderer; reuses
  `slide-renderer` with a fit-to-screen zoom.
- `export/pdf` — reads model and writes a PDF; calls into
  `@wafflebase/docs/export/pdf` for fonts and text embedding. The
  1920×1080 logical canvas maps to a 13.333" × 7.5" PDF page (960 ×
  540 PDF points at 72 dpi), matching Google Slides' default 16:9
  widescreen so exports render at the same physical size.

Dependencies:

- `packages/slides/package.json`: `dependencies: ["@wafflebase/docs"]`.
- `packages/frontend/package.json`: adds `"@wafflebase/slides"`
  (Yorkie SDK and docs are already there).

### Data model

```ts
type SlidesDocument = {
  meta: { title: string };          // theme stub removed in v1
  slides: Slide[];
  layouts: Layout[];
};

type Slide = {
  id: string;                       // stable; survives remote reorders
  layoutId: string;
  background: { fill: string; image?: ImageRef };
  elements: Element[];              // array order = z-order (last = front)
  notes: docs.Block[];              // speaker notes (rich text via docs)
};

type ElementBase = {
  id: string;                       // stable; used by presence/selection
  frame: {
    x: number; y: number;
    w: number; h: number;
    rotation: number;               // radians
  };
};

type TextElement = ElementBase & {
  type: 'text';
  data: { blocks: docs.Block[] };   // reuses @wafflebase/docs rich text
};

type ImageElement = ElementBase & {
  type: 'image';
  data: {
    // src always points to a workspace-hosted asset URL; v1 supports
    // three input paths that all funnel through the existing workspace
    // image API used by sheets (`packages/backend/.../images`):
    //   1. Toolbar "Insert image" → file upload
    //   2. Drag-and-drop a local file onto the canvas
    //   3. Paste from clipboard (image bytes)
    // External URL embed is deferred to v1.1.
    src: string;
    crop?: Crop;
    alt?: string;
  };
};

type ShapeElement = ElementBase & {
  type: 'shape';
  data: {
    kind: 'rect' | 'ellipse' | 'line' | 'arrow';
    fill?: string;
    stroke?: { color: string; width: number };
  };
};

type Element = TextElement | ImageElement | ShapeElement;

type Layout = {
  id: string;
  name: string;                     // "Title", "Title + body", "Blank"
  placeholders: PlaceholderSpec[];  // initial elements when layout applied
};
// Layouts in v1 are a fixed set defined in `model/layout.ts`; users
// cannot edit them. Master-slide style customization is v2 work.

// Applying a layout to an existing slide:
//   - Adds any placeholder elements missing from the slide.
//   - Does NOT delete or move user-edited elements.
//   - Does NOT replace text content of existing placeholders.
// Rationale: layout reapply should never destroy user work; richer
// "reset to layout" semantics arrive with the v2 master-slide system.

// Auxiliary shapes (filled in during implementation)
type Frame = ElementBase['frame'];
type ImageRef = { src: string; w: number; h: number };
type Crop = { x: number; y: number; w: number; h: number }; // fraction 0..1
type PlaceholderSpec = Omit<Element, 'id'>;
```

The slide canvas uses a fixed logical coordinate system (default
1920×1080). All editing, presentation, and PDF export operate in this
space; the editor only differs by zoom factor. This keeps DPR, zoom,
and export rendering consistent.

#### Store interface

```ts
interface SlidesStore {
  read(): SlidesDocument;

  // slide-level
  addSlide(layoutId: string, atIndex?: number): string;
  duplicateSlide(slideId: string): string;        // deep-copy + insert after
  removeSlide(slideId: string): void;
  removeSlides(slideIds: string[]): void;          // multi-select delete
  moveSlide(slideId: string, toIndex: number): void;
  moveSlides(slideIds: string[], toIndex: number): void;
  updateSlideBackground(slideId: string, bg: Slide['background']): void;
  applyLayout(slideId: string, layoutId: string): void;

  // element-level
  addElement(slideId: string, element: Omit<Element, 'id'>): string;
  removeElement(slideId: string, elementId: string): void;
  removeElements(slideId: string, elementIds: string[]): void;
  updateElementFrame(
    slideId: string,
    elementId: string,
    frame: Partial<Frame>,
  ): void;
  updateElementData(slideId: string, elementId: string, patch: object): void;
  // toIndex is the position in the elements array; 0 = back, length-1 = front
  reorderElement(slideId: string, elementId: string, toIndex: number): void;

  // text inside a text box (delegates to docs Tree)
  withTextElement(
    slideId: string,
    elementId: string,
    fn: (tree: docs.Tree) => void,
  ): void;
  // speaker notes (also a docs Tree)
  withNotes(slideId: string, fn: (tree: docs.Tree) => void): void;

  // groups undo/redo, mirrors sheets/batch-transactions
  batch(fn: () => void): void;
}
```

`MemSlidesStore` (in `packages/slides/src/store/memory.ts`) is the
reference implementation used by tests, the CLI, and any non-collab
context.

### Yorkie schema

`YorkieSlidesStore` in
`packages/frontend/src/app/slides/yorkie-slides-store.ts` adapts the
Yorkie root to the `SlidesStore` interface.

```
root (Yorkie Object)
├── meta: { title }                                   # LWW
├── slides: Yorkie.Array<Slide>                       # order = presentation order
│   ├── id: string
│   ├── layoutId: string
│   ├── background: { fill, image? }
│   ├── elements: Yorkie.Array<Element>               # order = z-order
│   │   ├── id: string
│   │   ├── type: 'text' | 'image' | 'shape'
│   │   ├── frame: { x, y, w, h, rotation }
│   │   └── data:
│   │        - text  → Yorkie.Tree                    # docs Tree shape
│   │        - image → Yorkie.Object
│   │        - shape → Yorkie.Object
│   └── notes: Yorkie.Tree                            # speaker notes
└── layouts: Yorkie.Array<Layout>                     # mirror of static set
```

Key semantics:

- One Yorkie document per presentation. Matches sheets/docs precedent.
- Slide reordering uses `Yorkie.Array.move` so that concurrent
  reorder operations converge to a deterministic order without
  index-collision conflicts.
- z-order is array order. There is no separate `zIndex` field, so two
  users adding elements concurrently get a deterministic resolved
  order rather than an LWW tie on a number.
- Drag/resize/rotate broadcast intermediate frames via presence only;
  `updateElementFrame` is committed once on mouseup. This avoids
  flooding CRDT operations during a drag (same pattern that sheets
  selection uses).
- Text-element bodies and `Slide.notes` are full Yorkie trees,
  identical in shape to the docs Tree, so the docs editor bridge can
  attach unchanged. The domain-level `TextElement.data.blocks` is the
  read view derived from this Tree; mutations always go through
  `withTextElement` / `withNotes`, which hand the live `Yorkie.Tree`
  to the caller. `MemSlidesStore` stores blocks directly without a
  Tree, mirroring how docs' in-memory store works.

#### Undo grouping (batch boundaries)

`store.batch(fn)` defines exactly one undo entry. The editor uses
these batch boundaries:

- One pointer interaction (drag, resize, rotate) = one batch, committed
  on `mouseup`. Intermediate frames travel only through presence and
  never produce CRDT operations.
- Toolbar / menu / shortcut actions (add slide, duplicate, delete,
  align, layout change, paste) = one batch each.
- Text editing inside a text box or notes follows the docs editor's
  IME-aware grouping (composition end + ~300 ms idle = one batch).
- Multi-step compound actions (e.g. paste-from-clipboard inserting N
  elements) wrap their inner mutations in a single `batch`.

### Presence

```ts
type SlidesPresence = {
  userId: string;
  name: string;
  color: string;
  selectedSlideId?: string;
  selectedElementIds: string[];
  textCursor?: { elementId: string; path: number[]; offset: number };
  draggingFrame?: {
    elementId: string;
    x: number; y: number; w: number; h: number; rotation: number;
  };
};
```

Stable `slideId` and `elementId` make selection survive remote
structural edits, reusing the design from
`sheets/axis-id-selection.md`. Peer cursor labels follow
`sheets/peer-cursor-labels.md` and the docs `docs-remote-cursor.md`
visual treatment.

### Rendering pipeline

A slide is one `<canvas>` plus a DOM overlay:

```
slide container (position: relative)
├── <canvas>                                    background + elements
└── <div class="overlay" position: absolute>
    ├── selection box + 8 resize handles + rotate handle
    ├── snap guidelines while dragging
    ├── peer cursor and selection rings (presence)
    └── <TextEditor>  (only while editing text)
        — contenteditable surface bridged to the docs IME path
```

- **Dirty tracking.** Each slide tracks a dirty flag; only changed
  slides re-render. Thumbnail re-render shares the same pixel data
  through a smaller canvas, debounced ~200 ms.
- **Coordinate system.** Drawing uses logical slide coordinates with
  zoom and DPR applied at the canvas transform level. Hit-testing is
  done in model space, accounting for `frame.rotation`.
- **Text rendering.** `view/canvas/element-renderer.ts` calls into the
  docs layout engine with the text box's `frame.w` and renders the
  resulting layout to canvas. When the user enters text-edit mode on a
  text element, a contenteditable surface is mounted in the same
  position and the docs IME bridge takes over keystrokes (`text-bridge.ts`).
- **Text-box overflow.** Text-box `frame.h` auto-grows downward to fit
  the laid-out content; `frame.w` stays fixed (resize handles change
  width and trigger re-layout). The text box never clips. Pinning a
  fixed height is a v1.1 affordance (toggle in the contextual toolbar).
- **Korean / CJK font fallback.** Canvas rendering uses the same font
  stack docs configures for its layout engine, including Noto Sans KR
  as the default CJK fallback. Slides reuses docs' font registry and
  loader rather than maintaining its own — there is one source of
  truth across the two engines.

### Editor UI

Default layout is two panes (thumbnails left, canvas center) plus a
collapsible notes strip below the canvas. All property editing happens
in the top contextual toolbar, which changes based on selection —
matching how Google Slides actually behaves.

```
┌─ Menu bar (File / Edit / View / Insert / Slide / Format / Help) ──┐
├─ Top toolbar (contextual; Present button on the right) ───────────┤
├──────────┬────────────────────────────────────────────────────────┤
│          │                                                        │
│ Thumbs   │              Slide canvas (editing area)               │
│ [1] •    │                                                        │
│ [2]      │                                                        │
│ [3]      │                                                        │
│ [+]      │                                                        │
│          ├────────────────────────────────────────────────────────┤
│          │  Speaker notes (collapsible, View → Show notes) ▾      │
└──────────┴────────────────────────────────────────────────────────┘
```

v1 toolbar surfaces:

- Always: `+ Slide`, `Layout`, `▶ Present`.
- Text selected: font family, size, B / I / U, color, alignment.
- Shape selected: fill, stroke color, stroke width.
- Image selected: replace, crop, alt.
- Slide background (no element selected): fill, layout.
- Multi-selection: only the intersection of properties common to all
  selected element types (typical case: position, frame size, delete,
  align). Mixed-type formatting is intentionally limited in v1.

Items not in this list are out of v1.

The thumbnail panel is collapsible via the View menu and uses virtual
scrolling to stay responsive at the v1 ceiling (~100 slides).

#### Context menus

Right-click (and long-press on touch) opens a context menu built on
the project's shared menu primitive (`docs/design/context-menu.md`):

- On a slide thumbnail: Duplicate, Delete, Insert above/below, Move up
  / down, Apply layout ▸.
- On a single element: Copy, Cut, Paste, Duplicate, Delete, Bring
  forward / Send backward / Bring to front / Send to back.
- On multi-selected elements: the same minus type-specific entries.
- On empty canvas: Paste, Insert text / image / shape ▸,
  Slide background ▸.

### Interactions

| Action | Input | Behavior |
|---|---|---|
| Select | click | hit-test → `selection.set([id])` → DOM handles appear |
| Multi-select | shift-click | toggle, handles wrap combined bbox |
| Lasso select | mousedown on empty canvas + drag | rubber-band rectangle; on mouseup, select all elements whose bbox intersects |
| Drag move | mousedown on element body | broadcast frame via presence at ~60 fps; commit `updateElementFrame` once on mouseup |
| Nudge | Arrow / Shift+Arrow | move selection by 1 px / 10 px in logical space |
| Resize | mousedown on resize handle | 8-direction, shift = preserve aspect; presence + commit on mouseup |
| Rotate | mousedown on rotate handle | free rotate, shift = 15° snap |
| Enter text edit | dblclick on text element | mount contenteditable overlay, run `withTextElement`; exit on blur or Esc |
| Add shape/text/image | toolbar then click/drag canvas | create element, `addElement` |
| Add slide | "+" button or Enter on thumbnail | `addSlide(currentLayoutId, currentIndex + 1)` |
| Duplicate slide | Cmd/Ctrl+D | `duplicateSlide(currentSlideId)` |
| Multi-select slides | shift-click in thumbnail panel | bulk delete / move via `removeSlides` / `moveSlides` |
| Reorder slides | drag thumbnail (single or multi) | commit `moveSlide`/`moveSlides` on drop |
| Copy / Cut / Paste elements | Cmd/Ctrl+C / X / V | clipboard format `application/x-wafflebase-slides+json` carrying `Element[]`; paste offsets by +10/+10 px and re-id; works across slides and presentations |
| z-order shortcuts | Cmd+↑ / Cmd+↓ / Cmd+Shift+↑ / Cmd+Shift+↓ | bring forward / send backward / to front / to back |
| Context menu | right-click / long-press | see "Context menus" above |
| Undo / Redo | Cmd/Ctrl+Z, shift+Z | restore the most recent `store.batch` group |

### Snap guides + align / distribute

Shipped together because they share the snap-engine + frame-math
substrate (`packages/slides/src/view/editor/snap.ts`,
`packages/slides/src/model/frame.ts`).

**Snap guides during drag.** `snapDelta` returns a `SnapGuide[]`
alongside the snapped delta; each guide has a `kind`
(`'slide-center'` | `'edge'`), an `axis` (`'x'` | `'y'`), and a
logical `position`. The drag
interaction stashes the guides on the editor and the overlay paints
them as 1-px magenta lines spanning the slide canvas. Guides clear
on `mouseup` via an explicit `repaintOverlay()` call after the
final frame commit — `render()` only repaints the canvas layer, so
the overlay needs its own kick. Candidates are tagged with `kind`
at construction time (the older "first candidate is slide-center"
index invariant was retired during code review).

**Align.** `SlidesEditor.align(direction)` accepts
`'left' | 'center-h' | 'right' | 'top' | 'center-v' | 'bottom'`. The reference rect depends on selection size:
multi-select uses `combinedBoundingBox` (a rotation-aware AABB over
the selected frames); single-select uses the slide canvas
(1920×1080). `alignFrames` writes new `frame.x` / `frame.y` values
and skips frames that already match the target — the result Map
contains only frames that actually moved.

**Distribute.** `SlidesEditor.distribute(axis)` (`'horizontal'` |
`'vertical'`) requires ≥3 selected elements. Frames are sorted by
their leading edge on the chosen axis; the two endpoints are
pinned, and gaps between consecutive frames are equalized.
Idempotent in the no-op sense (already-distributed frames are
skipped) but float-precision drift may produce sub-pixel moves on
repeated calls — see "Known limitations".

**Atomicity.** Each `align()` / `distribute()` call wraps its
frame writes in one `store.batch`, so undo/redo restores the whole
operation as a single step. `applyFrameUpdates` early-returns on
empty Maps so an align on already-aligned selection produces no
undo entry at all.

**Toolbar.** The contextual toolbar exposes 6 align buttons (left /
center / right / top / middle / bottom) plus 2 distribute buttons
(horizontal / vertical). Align buttons are
disabled when nothing is selected; distribute buttons are disabled
when fewer than 3 elements are selected.

#### Known limitations

- **Rotated multi-select align.** `combinedBoundingBox` is
  rotation-aware (AABB over rotated corners), but the values it
  produces are written directly to `frame.x` / `frame.y`, which is
  the *unrotated* element origin. As a result, the visible left /
  top edges of rotated elements may not coincide after the op —
  Google Slides aligns the rotated AABBs themselves. Planned for a
  follow-up.
- **Distribute float drift.** `distributeFrames` uses exact
  equality (`!==`) when filtering no-op frames. Repeated distribute
  calls on already-distributed selections may drift by ≪1 px and
  emit phantom undo entries. Tolerable while slide coords are
  integer-typed in the toolbar; revisit with an epsilon if undo-stack
  bloat is reported.

### Presentation mode

Implemented in `view/present/presenter.ts` plus the React shell
`presentation-mode.tsx`:

- `requestFullscreen` on a single canvas, render only the current slide
  via the same `slide-renderer` with `zoom = fit-to-screen`.
- Keyboard navigation: ←/→, Space, Page Up/Down to step; Home/End to
  jump; Esc to exit.
- Editing UI is fully disabled. Presence shows only the presenter's
  current slide so collaborators can follow along.
- Speaker notes are written and stored in v1, but the dual-screen
  presenter view that displays them ships in v2 (see Non-Goals).

### Error handling

- **Image load failure** — render a placeholder box with the alt text
  and a retry affordance.
- **Element deleted by collaborator while editing text** — close the
  contenteditable overlay and surface a non-blocking toast.
- **Resize on a rotated element** — covered by exhaustive unit tests
  on the rotation/resize matrix in `frame.ts`.
- **Layout removed by collaborator** — fall back to the system default
  layout for the affected slide.
- **Empty presentation** — render an empty-state placeholder and an
  explicit "Add slide" call to action.

### Integration points

Naming uses `'slides'` (plural) for the type identifier and the
package name. This trades a small inconsistency with the existing
singular `'sheet'` / `'doc'` for a name that matches the package and
reads naturally in English.

- **Prisma** — `Document.type` is already a free-form `String`; no
  schema change.
- **Backend Yorkie types** — add `SlidesDocument` to
  `packages/backend/src/yorkie/yorkie.types.ts`.
- **Frontend types** — extend `DocumentType` in
  `packages/frontend/src/types/documents.ts`:
  ```ts
  type DocumentType = 'sheet' | 'doc' | 'slides';
  ```
  and add a `type === 'slides'` branch in
  `packages/frontend/src/documents/document-detail.tsx` that lazy-loads
  `SlidesView`.
- **CLI** — new `packages/cli/src/commands/slides.ts` mirroring the
  docs CLI shape:
  - `slides list`
  - `slides create [--title ...]`
  - `slides delete <id>`
  - `slides content <id>` — print a JSON dump of the presentation for
    debugging / inspection (matches `docs content`).
  - `slides export <id> --format pdf`
  - `slides import` is intentionally absent in v1 (PPTX is out of
    scope; JSON re-import is a developer tool, not a CLI command).
- **REST API** — no slide- or element-level endpoints in v1. Existing
  `/api/v1/workspaces/:wid/documents` endpoints accept the new type
  unchanged.
- **Design docs** — this directory (`docs/design/slides/`) plus a new
  Slides section in `docs/design/README.md`.

### Phasing

Each phase ends with something demoable.

| Phase | Deliverable | Verification |
|---|---|---|
| P1. Foundation | Package scaffold, `model`, `MemSlidesStore`, unit tests | `pnpm slides test` |
| P2. Static rendering | Canvas slide-renderer + element-renderer, sample fixtures | Standalone HTML harness |
| P3. Editor (single user) | 2-pane shell, contextual toolbar, select/drag/resize/rotate, undo/redo | Vitest interaction tests + manual |
| P4. Yorkie + multi-user | `YorkieSlidesStore`, presence, peer cursors, backend type registration, frontend routing | `two-user-slides-yorkie.ts` integration tests |
| P5. Text + Present + Export | docs RichText bridge, presentation mode, PDF export, CLI | Integration tests + visual PDF check |

Phases P1–P3 don't touch backend, so progress is fast. P4 onward
crosses the package boundary into frontend and backend.

### Testing strategy

- **Unit (Vitest)** in `packages/slides/src/**/*.test.ts`.
  - `model/frame.ts` — coordinate math and rotation matrices, with
    fast-check property tests for round-trip invariants.
  - `model/element.ts` — element construction and validation.
  - `store/memory.ts` — every mutation, including `batch`.
  - `view/canvas/element-renderer.ts` — call sequences against a mock
    `CanvasRenderingContext2D`.
- **Integration** in `packages/frontend/tests/app/slides/`.
  - `yorkie-slides-store.test.ts` — `MemSlidesStore` and
    `YorkieSlidesStore` produce equivalent state for the same
    operation sequence.
  - `two-user-slides-yorkie.ts` helper — concurrent add / move / delete
    converge. Modeled on `two-user-yorkie.ts` and
    `two-user-docs-yorkie.ts`.
- **Visual / browser** (P5) — extend `verify:browser:docker` with at
  least one slides scenario covering thumbnails and presentation mode.
- **E2E (backend)** — `slides-cli-roundtrip.e2e-spec.ts` mirroring
  `docs-cli-roundtrip.e2e-spec.ts`.

Verification gates:

- End of each phase: `pnpm verify:fast`.
- End of P4: `pnpm verify:integration` (requires Postgres + Yorkie).
- End of P5: `pnpm verify:browser:docker`.

### Risks and Mitigation

| Risk | Impact | Mitigation |
|---|---|---|
| The docs rich-text bridge is harder than expected — docs assumes a paginated flow, and isolating a single text-box layout call may require non-trivial refactoring inside docs. | P5 slips. | Run a one-day spike inside docs at the end of P3 to identify where page assumptions live. If the surface is large, expose a dedicated text-box layout function from docs rather than reusing the page path. |
| Resize on rotated elements is a common bug surface. | UX regressions, hard-to-reproduce reports. | Exhaustive unit-test matrix in `frame.ts` covering 8 handles × representative rotation angles, plus property tests for round-trip invariants. |
| Concurrent element insertion produces an unintuitive z-order. | Collaborator confusion. | Document the rule ("array order is z-order; concurrent inserts append in deterministic Yorkie order"). Revisit explicit z-order in v2 if real users complain. |
| PDF export must handle Korean fonts (Noto KR) consistently with docs. | Garbled output. | Reuse `packages/docs/src/export/pdf.ts` for font loading and embedding rather than reimplementing. |
| The single-Yorkie-document assumption breaks at very large decks. | v2 carries unscoped work. | Document the v1 ceiling (~100 slides). The migration path to per-slide documents is a stepwise change similar to `docs-intent-preserving-edits`. |
| Depending on `@wafflebase/docs` couples slides to docs evolution. | PRs block each other. | Pin the surface slides uses to explicit exports from `packages/docs/src/index.ts`. Internal docs changes are free; surface changes require coordinated PRs. |

### Future parity with Google Slides

Slides v1 is intentionally a slice of Google Slides, not a clone.
A gap with Google Slides is expected at launch and the explicit goal
across subsequent releases is to **close that gap over time**.
The list below is the working backlog — not promises, but the items
that should be evaluated first when planning future versions.

**Tracked for v1.1** (in scope, deferred only because they are not
required for the first useful release):

- Hyperlinks on shapes and images (text hyperlinks come for free with
  the docs engine).
- External-URL image embed (in addition to the v1 upload / drag-drop /
  paste paths).
- Pinning a fixed text-box height (toggle in the contextual toolbar).

**Tracked for v2:**

- Group / ungroup elements (Cmd+⌥+G) — requires a new element kind or
  `groupId` attribute and ripples through selection, drag, hit-testing
  and the Yorkie schema.
- Speaker-notes presenter view (notes on a second screen during
  presentation; data model and per-slide notes panel are already in
  v1).
- Animations and slide transitions.
- Global theme system, master slides, and user-editable layouts.
- PPTX export.
- Comments and suggestions.
- Mobile zoom-to-fit (port of the docs equivalent).
- Per-slide Yorkie documents with lazy loading (when presentations
  routinely exceed ~100 slides).
- Right-side "Format options" panel (drop shadow, reflection, precise
  numeric inputs).
- Slide- / element-level REST API endpoints.

**Not currently planned but worth revisiting if asked for:**

- PPTX import (much larger surface than export).
- Embedded sheets, ranges, and charts inside a slide.
- Audience tools (Q&A, live captions, polls).

When closing items off this list, update both this section and the
matching Non-Goals entry above so the spec stays honest about where
the product is relative to its reference.
