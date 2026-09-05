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

- **Object and text formatting on a board** — fill, border, image alt
  text, text formatting, align / distribute / order / rotate, and
  group / ungroup, via a contextual toolbar section that morphs on
  selection (idle / object / text-editing), mirroring the slides
  toolbar's state machine. Image *replace* is deferred: `ImageControls`
  mounts without an `upload`, so its Replace affordance stays disabled on
  a board and insertion goes through the toolbar's Image button.
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
  `@wafflebase/slides` in this pass is additive and behavior-preserving
  for a slides mount — not all of it is *unreachable* there: the
  `Select all` context-menu entry is visible and functional on slides
  too (it dispatches the existing `Mod+A` rule, so it adds an
  affordance without changing any behavior). The existing slides suites
  are the merge gate.

Success = on a `"board"` document a user can select a shape and change
its fill and border, edit and format its text, align and reorder a
multi-selection, undo it from the toolbar, set zoom to a preset or fit
all content, and see collaborators' cursors move in real time — with
`pnpm verify:self` green and no change to slides behavior.

### Non-Goals (SP4)

- **Mobile board toolbar.** Slides has `MobileSlidesToolbar`; the board
  stays desktop-only this pass. (Touch *navigation* is no longer in this
  list — see "Touch navigation" below — but a board-shaped mobile shell
  still is.)
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

`ZoomControl` (`app/slides/toolbar/zoom-control.tsx`) renders against the
narrow `ZoomController` interface — `get / set / subscribe` plus the
`FIT_ZOOM` sentinel — so the board reuses the **UI** as-is and supplies
its own controller in a new `app/board/board-zoom.ts`.

The controller is board-local rather than slides'
`createZoomController` because the two clamp differently: slides allows
`[0.25, 4]` (`MIN_ZOOM`/`MAX_ZOOM`), while the board viewport's `zoomAt`
allows `[0.1, 8]`. Reusing the slides factory would clip the wheel-zoom
write-back below 0.25 or above 4, leaving the dropdown label reporting a
scale the canvas is not at. `FIT_ZOOM` is imported and reused unchanged
(`ZOOM_PRESETS` is the dropdown's own list — `ZoomControl` imports it,
`board-zoom.ts` never sees it); only the clamp differs.

The viewport stays the single source of truth — the controller is a
value holder for the label, never a second copy of the scale. Because a
board sits at `FIT_ZOOM` by default and returns to it after every fit,
routing Fit through that value channel alone would make it a no-op in
exactly the state users meet it in (`set()` early-returns on an unchanged
value). So `createBoardZoomBinding` pairs the value holder with the
actions it drives, and Fit is an ACTION rather than a value transition:

- `FIT_ZOOM` → always run the fit (`fit-to-content.ts`: fit all elements
  into the viewport), regardless of the stored value; the value is set
  too, so the label reads "Fit".
- A preset `N` → set `viewport.zoom = N`, anchored on the host centre so
  the visible content does not jump sideways.
- Wheel / pinch zoom writes back into the value channel
  (`reportViewportZoom`, called from `board-view.tsx`'s wheel handler —
  `board-wheel.ts` is the pure viewport math and holds no controller), so
  the dropdown label reflects the live scale rather than drifting from
  it. The write is label-only: applying happens on the intent, so a
  scale the viewport already anchored at the cursor is never re-resolved
  about the host centre.
- The canvas context menu's "Fit to content" calls `binding.fit()`,
  which does both halves — re-frame and move the readout to "Fit".

Zoom stays session-local view state: it never touches the CRDT document
or presence, matching both SP1's viewport rule and the slides zoom
contract.

### Touch navigation

Every pan path SP1 shipped needs hardware a touch screen does not have:
a keyboard for the Space-drag, a third mouse button for the middle-drag,
a wheel for the scroll. And `container`'s `touch-action: none` — set so
the browser cannot steal a drag — denied the browser its own pan on top
of that. The result was a board that a finger could not move at all,
past whatever happened to be on screen when it opened. Dragging the
minimap was the only way, which is not an answer on an unbounded plane.

`app/board/board-touch-gestures.ts` adds one-finger pan and two-finger
pinch zoom. Both commit through `commitViewport`, the same chokepoint
the wheel, the minimap and the zoom binding use, so the grid, the
minimap rect and the renderer stay in step for free.

**Ownership is decided at press time by what is under the finger**, and
that is the whole design:

- Empty canvas → ours. The press is stopped in the capture phase on
  `container` (the same placement, and for the same reason, as the
  Space/middle-drag handler), so a pan never also draws a lasso.
- An element or a selection handle → the editor's, untouched. The finger
  moves or resizes it exactly as a mouse would.

`touch-action` cannot express that distinction — it is a static
declaration and this is a per-press question — which is why the gesture
is coded rather than configured. The editor answers the question through
a new `hasContentAt(clientX, clientY)`, not a hit-test copied into the
host: the answer depends on the selection scope a group drill-in
establishes, which is editor state.

Two consequences, both deliberate:

- **A pinch that begins with a finger on an element is not a pinch.**
  That press is already an element drag, and there is no way to retract
  it once the editor's drag loop owns the pointer stream. Lifting and
  pinching on empty canvas zooms. The alternative — delaying every touch
  drag by a pinch-detection window — taxes the common gesture to serve
  the rare one.
- **Lasso multi-select is not reachable by finger**, since one finger on
  empty canvas pans. This matches Miro, and tap-to-select plus
  shift-less single selection still works.

A read-only mount answers `hasContentAt` with "nothing, anywhere": it
binds no pointer handlers, so conceding a press over an element would
hand it to nobody and leave a viewer stuck wherever their finger landed.

The claim is scoped to the drawing surface — the canvas and the
selection overlay — not to everything under `container`. The minimap is
a child of that same element with its own bubble-phase drag, and
`hasContentAt` hit-tests the *scene*, so a press over the minimap reads
as empty canvas. Claiming it would have panned the plane instead of
navigating, cleared the selection on a tap, and opened the canvas menu
on top of the minimap — and the outcome would have depended on whatever
the minimap happened to be covering. Taking away the one pan path touch
already had would have been a poor trade for adding one.

Two callbacks close gaps the claim itself opens.

`onEmptyTap` runs `editor.clearSelectionAndScope()` — not
`setSelection([])`, which reaches `Selection.set` only. A press on empty
canvas drops the selected ids **and** pops any group drill-in, refitting
each group popped on the way out; the mouse path has done both since
08bb636ec, and a scope no finger could exit would also change who owns
every subsequent press, since `hasContentAt` resolves at the current
scope.

`onLongPress` opens the canvas context menu — the editor times its own
long-press, but never sees these presses, and Paste, the insert entries
and Snap to grid live nowhere else on a touch screen. It is suppressed
on a read-only mount.

Claiming a press also dismisses any open context menu. `stopPropagation`
in the capture phase halts the event before it reaches the descendants
*and* before it bubbles back to `document`, where the menu's own
outside-press dismissal listens — so on a device with no Escape key a
tap meant to close the menu would have left it open.

Handle tolerance comes from the same `(pointer: coarse)` test the slides
mounts use; see `docs/design/slides/slides-mobile.md` § "Touch beyond
the mobile shell" for the rest of the shared touch work (drag
thresholds, the multi-touch guard, menu and toolbar sizing).

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

/** Deliberately NOT part of PeerOverlays — see below. */
function computePeerCursors(
  peers: readonly PeerView[],
  currentSlideId: string | undefined,
): Array<{ x: number; y: number; color: string; label: string }>;
```

Cursors are computed and painted **separately from the rest of the peer
chrome**, into a dedicated `wfb-slides-peer-cursor-layer` child of the
editor's overlay. This is not cosmetic layering — it is what makes a
pointer-rate presence channel safe:

- `renderOverlay` clears `overlay.innerHTML` on every call, and the docs
  `TextEditor` mounts its hidden IME textarea *inside* the text-box
  container that lives in that overlay. A full overlay rebuild therefore
  detaches the textarea and drops focus to `<body>`, after which the
  local user's keystrokes reach the editor's GLOBAL key rules (Delete
  deletes the selected element) instead of the text they are typing.
- The rebuild also re-walks every element (`buildElementWorldLookup`) and
  repaints over any in-flight gesture ghost.

So `setPeers` diffs the incoming peers against the current ones ignoring
`cursor` (`peersEqualIgnoringCursor`). A cursor-only tick repaints just
the cursor layer — no `store.read()`, no element walk, no
`innerHTML = ''`; anything else falls through to the full
`repaintOverlay()`. The cursor layer sits at the overlay's origin and
uses the same `world * scale + pan` math the rings use (and is
re-appended after every rebuild), so a cursor still cannot drift from its
owner's selection ring during a pan or zoom.

Slides never populates `cursor`, so `computePeerCursors` returns `[]`
there and the layer is never even created.

Board side (`board-view.tsx`):

- `pointermove` on the canvas host publishes `cursor` into
  `BoardPresence` — the field SP1 already defined but left unwritten —
  coalesced to at most one write per animation frame, alongside the
  existing `selectedElementIds` publish.
- `pointerleave` publishes `null` so a departed cursor does not stick.
- `mapBoardPeers` forwards `presence.cursor` into `PeerView.cursor`.

Both writes go through `YorkieBoardStore.updatePresence()`, never
`doc.update` directly. `batch()` holds one `doc.update` open for the
whole batch, and the selection listener fires synchronously from inside
it (an insert commit selects the element it just added) — a nested
`doc.update` there reissues the open change's `clientSeq`, the server
refuses the pack, and the document never syncs again. `updatePresence`
folds into the batch's ambient presence proxy when one is open; see the
class comment on `YorkieBoardStore.activePresence`. Presence reads still
go straight to the document.

"At most one write per frame" is a ceiling, not a rate: a presence write
emits a SELF `presence-changed` that re-renders the whole React tree, so
`createCursorPublisher` also drops a frame whose position is unchanged,
and skips the write entirely when `doc.getOthersPresences()` is empty —
a solo user waving the mouse must not cost 60 React commits a second.

A skipped write is remembered as *undelivered*, never as delivered, and
`pushPeers` calls `cursorPublisher.resend()` when the peer count goes
0 → >0. Without that replay the gate would lose state rather than just
defer it: a user who was stationary when the peer joined would stay
invisible, and a `pointerleave` that fell while solo would leave a ghost
cursor parked in presence for the next peer to find.

### Files

```text
packages/slides/src/view/editor/
  peers.ts            + PeerView.cursor, + computePeerCursors,
                      + peersEqualIgnoringCursor (the cursor-only diff)
  overlay.ts          + renderPeerCursors (own layer, not renderOverlay)
  editor.ts           + peer-cursor layer + cursor-only setPeers path,
                      + onFitToContent option, + Select all / Fit to content

packages/frontend/src/app/slides/toolbar/
  arrange-menu.tsx    + minAlignSelection prop (default 1)
  can-ungroup.ts NEW  shared Ungroup predicate (slides + board)

packages/frontend/src/app/board/
  board-toolbar.tsx   morphing shell: undo/redo + zoom + insert + contextual
  board-zoom.ts  NEW  board ZoomController (board clamp) + binding: FIT = fit-all
                      action + label, presets, wheel label write-back
  board-cursor-publish.ts NEW  rAF coalescing + delta / audience gating
  board-view.tsx      wire zoom binding, onFitToContent, cursor publish
```

### Testing

- `board-zoom.test.ts` — `FIT_ZOOM` ↔ preset transitions, center-anchored
  preset zoom, wheel-zoom write-back, clamping.
- `board-toolbar-state.test.ts` — `getToolbarState` against a board store
  transitions idle → object → text-edit, and reports the right
  `selectionType` per element type.
- `peers.test.ts` (slides) — `cursor` maps into a cursor spec; **absent
  `cursor` yields an empty array** (the regression guard proving slides
  is unaffected); `peersEqualIgnoringCursor` sees through a cursor move
  but not through a selection / live-frame / guide / cell-range change.
- `peer-cursor-text-focus.test.ts` (slides) — mounts a REAL text box (not
  the mock the other suites inject) and asserts the hidden IME textarea
  keeps focus across cursor-only `setPeers` ticks, that the moved cursor
  still paints, and that the layer survives a full overlay rebuild.
- `board-cursor-publish.test.ts` — rAF coalescing, the null-on-leave
  delivery, the unchanged-position gate, the audience gate, and the
  replay it needs: a stationary cursor becomes visible when the audience
  opens, a `null` the closed gate swallowed is not remembered as
  published, and a solo user still writes nothing at all.
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
  CRDT presence channel. *Mitigation:* at most one write per animation
  frame, skipped when the position has not moved or when there are no
  peers, and `null` on pointer leave. Presence only — the document root
  is never touched.
- **The audience gate silently dropping state.** Skipping a write while
  solo is only safe if the skip is remembered as *undelivered*: otherwise
  a `pointerleave` that lands while nobody is watching strands a ghost
  cursor in presence, and a user who was stationary when a peer joined
  never appears. *Mitigation:* `published` (what presence holds) is
  written only on a real publish, and `pushPeers` replays the pending
  intent via `resend()` on the peer-count 0 → >0 transition. A fresh
  publisher starts with `published` UNKNOWN, so a mount-effect re-run
  cannot mistake a stale presence cursor for "nothing published".
- **A pointer-rate presence channel amplified into pointer-rate DOM
  work.** Peer presence used to rebuild the entire overlay on every
  `setPeers` call, which was tolerable only because slides presence
  changes at edit rate. Driving it at cursor rate made that rebuild
  continuous, and the rebuild blurs the in-place text editor (the docs
  `TextEditor`'s hidden IME textarea lives in the overlay), so a peer
  moving their mouse made local text editing unusable. *Mitigation:* the
  cursor-only diff + dedicated cursor layer described under **Peer
  cursors** above.

### Known limitations

- After picking "Fit", a window resize re-lays out the canvas but does
  not re-fit, while the dropdown label still reads "Fit". Fit is an
  action, not a sticky mode; making it sticky needs a resize-time
  re-fit keyed on the label, which is deferred.
- Any non-cursor peer activity still rebuilds the overlay, and so still
  blurs a local in-place text edit. That is broader than presence: a peer
  changing their selection or moving their live drag frames reaches it
  through `setPeers` → `repaintOverlay()`, and **any remote document
  edit** reaches it through `board-view.tsx`'s `store.onChange` →
  `editor.markDirty()` → `repaintOverlay()`. Same class, same
  pre-existing root (`renderOverlay` clears `overlay.innerHTML`, which
  detaches the docs `TextEditor`'s hidden textarea), and still edit-rate
  rather than pointer-rate. The proper fix is the deferred
  gesture/edit-lifecycle signal tracked with the P2 live-frame broadcast
  work; a focus restore is not it, because
  `docs/src/view/text-box-editor.ts` wires blur → `cancelComposition()` →
  `onCommit`, so by the time it would run the session has already
  committed and the IME composition is gone.
- The board toolbar does **not** release focus back to the canvas after a
  control is used, so board inherits issue #882: once a toolbar `<button>`
  is focused, `isEditableTarget()` makes the document-level `keydown`
  handler skip every selection shortcut until the canvas is clicked again.
  Slides fixes this with the opt-in `useCanvasFocusRelease()` hook
  (`docs/design/slides/slides-keyboard-shortcuts.md`, "Toolbar focus
  release"), and board could mark its `<Toolbar>` with
  `data-canvas-toolbar` to inherit it — but that would also change what the
  *next* `Space` does. The board `BUTTON` branch in
  `packages/frontend/src/app/board/is-editable-target.ts` exists so `Space`
  on a focused toggle re-activates the toggle rather than entering pan
  mode; with focus dropped to the body, `Space` would enter pan mode
  instead. Adopting the hook on board therefore means deciding that
  trade-off (or keeping toggles out of the release), which is deferred.
