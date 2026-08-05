---
title: board-editing-parity
target-version: 0.6.3
---

<!-- Make sure to append document link in design README.md after creating the document. -->

# Board — Editing Parity (SP4)

## Summary

SP1–SP3 gave the board a collaborative infinite canvas
([board.md](board.md)), whiteboard elements
([board-whiteboard-elements.md](board-whiteboard-elements.md)), and Miro
import ([board-miro-import.md](board-miro-import.md)). What they did not
give it is the ability to *change* anything about an object once it is
placed: the board toolbar is insert-only (Select / Text / Sticky ▾ /
Image / Shape ▾ / Line ▾), so there is no fill, border, text formatting,
align, or order control anywhere in the UI. Undo works from the keyboard
but has no button, and zoom has no readout or preset picker — only the
one-shot fit that runs when the document opens.

SP4 closes that gap by **composing controls the slides toolbar already
ships** against the board's existing `SlidesStore` adapter. The
governing constraint from SP1 still holds — *a board is one unbounded
slide, viewed through a pan/zoom viewport* — and it is what makes the
reuse work: `YorkieBoardStore.read()` returns a complete
`SlidesDocument` whose single synthetic slide is the board, so
`getToolbarState()`, `ShapeControls`, `ImageControls`,
`TextElementControls`, `TextEditSection`, `ArrangeMenu`, `UndoRedoGroup`
and `ZoomControl` all operate on a board unmodified.

Two smaller gaps ride along: the canvas right-click menu (which the
slides *engine* already provides to board mounts) is missing two
board-specific entries, and peer cursors — wired into `BoardPresence` in
SP1 but never published or painted — are finished here.

### Goals

- **Object and text formatting on a board** — fill, border, image
  replace/alt, text formatting, align / distribute / order / rotate, and
  group / ungroup, via a contextual toolbar section that morphs on
  selection (idle / object / text-editing), mirroring the slides
  toolbar's state machine.
- **Undo / Redo buttons** wired to the board store's existing
  undo stack (keyboard ⌘Z already works through the shared editor
  keyboard rules).
- **Zoom control** — a `Fit` / 50 / 75 / 100 / 150 / 200 % dropdown
  whose `Fit` means *fit all content* (the board analogue of slides'
  fit-to-column), kept in sync with wheel and pinch zoom.
- **Canvas context-menu completion** — add `Select all` and
  `Fit to content` to the empty-canvas menu.
- **Peer cursors** — publish the local pointer position into board
  presence and paint remote cursors as dots with name tags, in the same
  overlay pass that already paints peer selection rings.
- **Regression gate:** slides behavior is preserved. Every change to
  `@wafflebase/slides` in this pass is strictly additive and unreachable
  from a slides mount; the existing slides suites are the merge gate.

Success = on a `"board"` document a user can select a shape and change
its fill and border, edit and format its text, align and reorder a
multi-selection, undo it from the toolbar, set zoom to a preset or fit
all content, and see collaborators' cursors move in real time — with
`pnpm verify:self` green and no change to slides behavior.

### Non-Goals (SP4)

- **Mobile board toolbar.** Slides has `MobileSlidesToolbar`; the board
  stays desktop-only this pass.
- **Comments, PNG/PDF export, CLI support.** Cross-cutting parity work,
  deferred to SP5.
- **A board theme concept or theme switcher.** The color pickers surface
  the `defaultLight` palette that `boardToSlidesDocument` already pins;
  see Risks.
- **Table controls.** A board never creates tables (the toolbar omits
  the picker, paste strips them, and `YorkieBoardStore` throws
  `notSupported` on table ops), so the `table` selection branch renders
  nothing.
- **Presence viewport-follow, spatial index, Miro OAuth.** Still
  deferred, per SP1–SP3.

## Proposal Details

### Why the reuse works

`YorkieBoardStore.read()` returns a `SlidesDocument` built by
`boardToSlidesDocument()` (`packages/board/src/model/board.ts`): one
slide with `id === 'board'`, the built-in `blank` layout, `DEFAULT_MASTER`,
and the `defaultLight` theme. Every toolbar control the board wants is
already written against `(editor, store, theme)` and looks its slide up
by `editor.getCurrentSlideId()` — which on a board resolves to the
synthetic slide. No control needs a board-specific code path.

The parts that do *not* transfer are the slide-scoped ones — slide
add/duplicate/reorder, layout, background, theme, motion, tables — and
those are exactly the methods `YorkieBoardStore` throws `notSupported`
on. SP4 keeps them out by composing the leaf controls board-side rather
than reusing the slides toolbar shell.

### Toolbar composition

`board-toolbar.tsx` grows from an insert-only bar into the same
three-state morphing shell slides uses, laid out board-side:

```text
[↶][↷] │ [Zoom ▾] │ [Select][Text][Sticky▾][Image][Shape▾][Line▾] │ ‹contextual›
```

The contextual zone routes on `getToolbarState(editor, store)`
(`app/slides/toolbar/state.ts`, reused as-is):

| State | Rendered |
| --- | --- |
| `idle` | nothing (insert tools only) |
| `object` / `shape`, `connector` | `ShapeControls` + `ArrangeMenu` |
| `object` / `image` | `ImageControls` + `ArrangeMenu` |
| `object` / `text-element` | `TextElementControls` + `ArrangeMenu` |
| `object` / `mixed` | `ArrangeMenu` only |
| `object` / `table` | nothing (unreachable on a board) |
| `text-edit` | `TextEditSection` |

`ObjectSection` itself is **not** reused: it hardcodes the slides
`InsertGroup` (which includes the table picker the board deliberately
omits) and routes the `table` branch into `TableControls`. Composing the
leaf controls directly costs a few lines of layout and avoids both.

### The one slides change the toolbar needs: `align` on an unbounded plane

`SlidesEditor.align()` aligns to *the combined bounding box of the
selection* when ≥ 2 elements are selected, but to *the slide canvas
(1920 × 1080)* when exactly 1 is. The second rule is meaningless on an
infinite plane — a lone element would jump into a phantom rectangle near
the world origin.

`ArrangeMenu` gains an optional prop:

```ts
/** Minimum selection size for Align to be enabled. Default 1 (slides). */
minAlignSelection?: number;
```

`canAlign` becomes `selectionSize >= (minAlignSelection ?? 1)`; the board
passes `2`. Additive, defaulted, and slides' behavior is unchanged. The
underlying `align()` is not touched — the board simply never reaches its
single-selection branch.

### Zoom

`createZoomController` (`app/slides/zoom-controller.ts`) is a pure value
holder: `get / set / subscribe`, a `FIT_ZOOM` sentinel, clamping to
`[MIN_ZOOM, MAX_ZOOM]`, and no persistence. The board reuses it verbatim
and supplies the *meaning* in a new `app/board/board-zoom.ts`:

- `FIT_ZOOM` → run the existing `fit-to-content.ts` path (fit all
  elements into the viewport).
- A preset `N` → set `viewport.zoom = N`, anchored on the viewport
  center so the visible content does not jump sideways.
- Wheel / pinch zoom (`board-wheel.ts`) writes back into the controller,
  so the dropdown label always reflects the live scale rather than
  drifting from it.

Zoom stays session-local view state: it never touches the CRDT document
or presence, matching both SP1's viewport rule and the slides zoom
contract.

### Canvas context menu

The slides *engine* already builds and shows the canvas context menu
(`packages/slides/src/view/editor/editor.ts`, `onContextMenu` →
`elementContextItems` / `canvasContextItems`), and board mounts already
pass `suppressSlideChrome: true` to drop the slide-scoped
"Change layout…" entry. Element right-click therefore already offers
Copy / Cut / Paste / Duplicate / Delete / Group / Ungroup / z-order /
text vertical-align / connector routing on a board today.

Two entries are added to `canvasContextItems`, both board-relevant and
harmless on slides:

- **Select all** — dispatches the existing `Mod+A` rule
  (`shortcuts-catalog.ts`: "Select all elements on the current slide"),
  the same way the menu's Copy / Cut / Paste entries dispatch theirs. No
  new selection logic.
- **Fit to content** — invokes the host's fit hook. Because fit is a
  viewport concern the engine does not own, it is exposed as an optional
  editor option (`onFitToContent?: () => void`) that the board supplies
  and slides omits; the entry is skipped when the hook is absent.

### Peer cursors

`PeerView` (`packages/slides/src/view/editor/peers.ts`) currently models
selection rings, name tags, guide previews, and table cell ranges — but
no cursor. SP4 extends it, additively:

```ts
interface PeerView {
  // …existing fields
  /** Live pointer position in WORLD coords, when the peer publishes one. */
  cursor?: { x: number; y: number };
}

interface PeerOverlays {
  // …existing fields
  cursors: Array<{ x: number; y: number; color: string; label: string }>;
}
```

`computePeerOverlays` maps a peer's `cursor` into `cursors` (same
current-slide filter as rings), and `overlay.ts` paints each as a dot
with the peer's stable color plus its name tag. Slides never populates
`cursor`, so `cursors` is always empty there and its paint loop is a
no-op — the change is unreachable from a slides mount.

Board side (`board-view.tsx`):

- `pointermove` on the canvas host publishes `cursor` into
  `BoardPresence` — the field SP1 already defined but left unwritten —
  throttled to one write per animation frame, alongside the existing
  `selectedElementIds` publish.
- `pointerleave` publishes `null` so a departed cursor does not stick.
- `mapBoardPeers` forwards `presence.cursor` into `PeerView.cursor`.

Painting cursors in the editor's overlay pass rather than in a separate
DOM layer keeps them on the same transform path as the selection rings,
so a peer's cursor and their selection ring cannot drift apart during a
fast pan or zoom.

### Files

```text
packages/slides/src/view/editor/
  peers.ts            + PeerView.cursor, + PeerOverlays.cursors, mapping
  overlay.ts          + cursor dot / name-tag paint
  editor.ts           + onFitToContent option, + Select all / Fit to content

packages/frontend/src/app/slides/toolbar/
  arrange-menu.tsx    + minAlignSelection prop (default 1)

packages/frontend/src/app/board/
  board-toolbar.tsx   morphing shell: undo/redo + zoom + insert + contextual
  board-zoom.ts  NEW  board zoom controller (FIT = fit-all, presets, wheel sync)
  board-view.tsx      wire zoom controller, onFitToContent, cursor publish
```

### Testing

- `board-zoom.test.ts` — `FIT_ZOOM` ↔ preset transitions, center-anchored
  preset zoom, wheel-zoom write-back, clamping.
- `board-toolbar-state.test.ts` — `getToolbarState` against a board store
  transitions idle → object → text-edit, and reports the right
  `selectionType` per element type.
- `peers.test.ts` (slides) — `cursor` maps into `cursors`; **absent
  `cursor` yields an empty array** (the regression guard proving slides
  is unaffected).
- `arrange-menu` — Align disabled at selection size 1 when
  `minAlignSelection={2}`, enabled at 2; slides default unchanged.
- The full existing slides suite (import / export / round-trip / painter
  / interaction) stays green — the merge gate for the engine commit.
- Manual smoke in `pnpm dev`: two tabs on one board — format a shape,
  edit text, align a pair, undo from the toolbar, switch zoom presets,
  and confirm cursors track.

### Commit staging

1. **Slides additive surface** — `PeerView.cursor` + overlay paint,
   `onFitToContent` + the two canvas menu entries, `minAlignSelection`.
   Gate: the slides suite stays green *before* any board code depends
   on it.
2. **Board zoom + global controls** — `board-zoom.ts`, Undo/Redo and
   Zoom in `board-toolbar.tsx`.
3. **Board contextual formatting** — the morphing contextual zone.
4. **Board peer cursors** — presence publish + `mapBoardPeers`
   forwarding.

## Risks and Mitigation

- **Reusing slide-scoped controls would hit `notSupported`.** The board
  store throws on slide / layout / theme / master / animation / table
  ops. *Mitigation:* compose leaf controls board-side instead of reusing
  the `SlidesToolbar` / `ObjectSection` shells, so no slide-scoped
  control is ever mounted; the `table` selection branch renders nothing.
- **`align()` single-selection targets a phantom slide rect.** Covered
  above via `minAlignSelection`; the board never reaches that branch.
- **Color pickers expose a theme a board does not have.** The synthetic
  deck pins `defaultLight`, and the renderer already resolves themed
  colors against it — so the picker is internally consistent, and a
  themed role behaves as a stable 12-color palette. The pre-existing
  oddity that themed colors stay light-derived on a dark-mode canvas is
  inherited from SP1 and explicitly **not** addressed here; introducing
  a board theme is a separate design.
- **Slides is the high-blast-radius consumer of the shared toolbar and
  overlay.** *Mitigation:* every slides-side change is additive with a
  slides-preserving default (`minAlignSelection ?? 1`, absent
  `onFitToContent`, empty `cursors`), and commit 1 lands with the slides
  suite green before board code consumes it.
- **Cursor presence churn.** A raw `pointermove` publish would flood the
  CRDT presence channel. *Mitigation:* one write per animation frame,
  and `null` on pointer leave. Presence only — the document root is
  never touched.
