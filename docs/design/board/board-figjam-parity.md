---
title: board-figjam-parity
target-version: 0.6.15
---

# Board: FigJam-Parity Usability

## Summary

PRODUCT.md makes Google parity the default for editor behaviour, but
Google has no whiteboard any more (Jamboard is gone), so for the board the
familiar product is FigJam, with Miro close behind. This document records
the first usability pass toward it, which came out of an Impeccable
critique of the board (2026-11-16, 19/40), and lays out the phased plan for
the rest.

The critique's diagnosis is the organizing idea: **the board is the Slides
editor without slide edges.** That reuse is why the board shipped quickly,
and it is also why the board's own object, the sticky note, had fewer
affordances than a rectangle, why its menus speak OOXML ("Elbow
connector", "Block arrows"), and why behaviour that suits a deck (a 70-shape
picker, Escape discarding an edit) leaked onto a canvas. Every phase below
moves one piece from "inherited from Slides" to "designed for a board",
without forking the shared scene engine.

### Goals

- A newcomer can make, edit and arrange stickies without a lesson, and
  nothing they type is lost.
- Every viewer sees the same board in both app themes.
- A FigJam user's hands work: tool keys, Esc, the canvas menu.
- Each phase keeps the shared Slides engine shared: board behaviour comes
  in through host options and board-local components, never a fork.

### Non-Goals

- Pixel-matching FigJam's visual design. The board keeps the Ruled Ledger
  system (DESIGN.md): zinc chrome, one syrup accent, the grid.
- FigJam's audio, video and widget/plugin platform.
- A board theme switcher. The plane is a document surface pinned to the
  deck theme (§ Board plane); a per-board background is a later option.

## Proposal Details

### Shipped in the first pass

| Change | Where | Why |
| --- | --- | --- |
| **Esc keeps the text it leaves.** Slides and board both commit on Esc; `exitEditMode('cancel')`, crop and drag still cancel. | `slides/src/view/editor/editor.ts` (`enterEditMode`) | Esc discarded a typed sticky, under a comment calling that the Google convention. It is not: Google Slides, FigJam and Miro all keep it. |
| **Board plane** stays light in dark mode; grid, minimap and peer cursors use the light variant. | `frontend/src/app/board/board-plane.ts` | Content resolves against the pinned `defaultLight` deck theme. A dark plane drew default text near-black on near-black, and invited fixes invisible to light-mode peers. |
| **Sticky placement** steps right off an occupied centre. | `sticky.ts` `freeStickyCenter` | The second sticky covered the first exactly, and read as the first vanishing. |
| **Sticky controls**: a sticky-only selection shows the six sticky colours inline; "Insert sticky note" leads the canvas menu's insert group at the clicked point. | `sticky-controls.tsx`, `isStickyElement`, `hostInsertMenuItems` | A sticky got the rectangle's border/dash/gradient controls; recolouring took two clicks into a 40-swatch picker. |
| **Minimap frame** clipped to the panel; panel no longer crops its canvas. | `minimap-geometry.ts` `clipToMini`, `board-minimap.ts` | Zoomed out past the content, the frame was drawn off-canvas and showed as a stray line. |
| **Tools and shortcuts**: V T S R O L Shift+L X, Shift+1 to fit, hints in tooltips, a board shortcut sheet on Mod+/, an empty-board hint. | `board-shortcuts.ts`, `board-empty-hint.tsx` | None of the board's shortcuts were findable; Mod+/ did nothing. |
| **Zoom presets** down to 10%. | `BOARD_ZOOM_PRESETS` | The dropdown stopped at 50% while the wheel reaches 10%. |

#### Board plane

The board's synthetic deck pins `defaultLight` (`boardToSlidesDocument`),
and themed colours resolve against it. The plane is therefore a document
surface, not chrome: it takes `defaultLight.colors.background` in both app
themes, and everything painted on it uses the light palette. Only the
toolbar and the rest of the chrome follow the app theme. This is the
FigJam/Miro arrangement, and it is what keeps two collaborators in
different app themes looking at the same board.

#### Tool keys vs type-to-edit

Slides' type-to-edit (a printable key on a selected text or shape starts
editing it, with the key as the first character) is Google-parity and stays.
FigJam's tool keys would collide with it on a selection, so tool keys fire
**only with nothing selected**. This matches what both products do in the
common case (a selected sticky receives the typing). The cost is that
switching tools with a selection takes Esc first.

### Second pass: navigation, presence, ink

A code audit after the first pass (2026-11-16) found three gaps that the
roadmap below does not cover, and that make every other board feature feel
worse. They ship as three PRs, in this order.

**A. Navigation feel (shipped)**

| Change | Where | Why |
| --- | --- | --- |
| **Continuous wheel zoom**: `factor = exp(-Δ·0.01)`, \|Δ\| capped at 10 px per event, deltas normalised from line/page mode. | `board-wheel.ts` | Every ctrl+wheel event zoomed a fixed 10%. A trackpad pinch is a stream of small events, so a pinch was stepped and several times too fast. The cap keeps a mouse notch at the old ~10%. Firefox's line-mode wheel panned 3 px per notch. |
| **Shift + wheel** pans sideways. | `board-wheel.ts` | A Windows mouse has no other horizontal pan. macOS already swaps the axes and is left alone. |
| **Zoom keys**: Mod+= / Mod+- step through presets (auto-repeat allowed), Mod+0 is 100%, Shift+2 frames the selection (up to 200%). The browser's page zoom is suppressed on the board. | `board-shortcuts.ts`, `board-zoom.ts` `stepZoomPreset` | The only keyboard zoom was Shift+1. Mod+= zoomed the browser page and blurred the UI. Stepping to presets means a wheel-zoomed 137% goes to 200%, not to 151%. |
| **800% preset.** | `BOARD_ZOOM_PRESETS` | The wheel already reached 8×. |
| **Hand tool**: `H` and a toolbar toggle. A left-drag on the scene pans, a finger on content pans, and a double-click stays a pan. Arming it clears the selection. Any other tool disarms it, and so does Esc. On a read-only board a plain drag pans without the tool. The drag rule lives in `claimsPanDrag`, which leaves the minimap its own drag. | `board-hand.ts`, `board-view.tsx` | Panning needed Space, a middle button or a wheel. A read-only viewer's drag did nothing at all. |
| **Pan cursor** is written as `data-board-pan` on the canvas and overlay, and enforced with an `!important` rule. | `board-hand.ts` `BOARD_PAN_CURSOR_CSS` | The editor rewrites `canvas.style.cursor` on every hover, so Space's `grab` was lost as soon as the pointer moved. |
| **Toolbar focus release** (#882) through `useCanvasFocusRelease()`. | `board-toolbar.tsx` | After a toolbar click, selection shortcuts stayed dead until the canvas was clicked. The deferred trade-off (Space on a focused toggle) resolves itself: the hook leaves focus that the user reached by Tab, so a keyboard user's Space still activates the toggle, and a mouse user's Space pans. |

**B. Peer cursors v2 (planned)**

Today a cursor is a 10 px dot, sent on every animation frame. Each presence
update re-creates the cursor DOM, so the dot teleports at whatever rate the
network delivers. The Yorkie `simultaneous-cursors` example
(`yorkie-js-sdk/examples/simultaneous-cursors`) solves the same problem
with presence alone and no extra dependency. The board will adopt its
techniques:

- **Send** at most every 40 ms. Skip a move under a dead-band but keep
  accumulating it, and send the exact final position once the pointer has
  rested for 100 ms. That halves presence traffic, and the cursor still
  stops where the peer stopped. Coordinates stay in world space: unlike the
  example's viewport fractions, world coordinates are what lets two peers
  with different pan and zoom agree.
- **Render** with a critically damped spring (stiffness ≈ 480,
  damping = 2√k, dt capped at 1/30 s) on rAF. It writes `transform` to
  keyed, persistent DOM nodes, and the loop stops once every cursor has
  settled. A CSS transition would restart a straight line on each update.
  The spring keeps velocity, so a curve stays a curve.
- **Shape**: an arrow plus a name tag in place of the dot, and a pen glyph
  while the peer is drawing (C).
- **Board-specific additions**, which the example does not need:
  - an edge indicator for a peer who is off-screen;
  - click a header avatar to jump to that peer;
  - re-send the world position when the local viewport changes under a
    still pointer (wheel pan/zoom fires no `pointermove`);
  - show peers in the minimap.

**C. Marker and ink (planned)**

Drawing is Slides' Scribble. It is straight segments, it drops back to
Select after each stroke, it has no colour or width, and it reads the whole
document on every pointer move. From the example:

- **Live stroke in presence, finished stroke in the document.** While
  drawing, `presence.stroke = {tool, color, width, points}` carries the
  whole current stroke, so a missed update self-heals. On pointerup, one
  `doc.update` commits the element and clears the presence stroke. A long
  stroke commits in chunks of about 64 points, so presence stays bounded.
- **Points as one quantised string**, not a CRDT array of numbers.
- **Two layers.** Committed strokes come from the renderer. The live
  stroke, local and remote, goes on its own overlay canvas, which also
  removes the per-move `store.read()`. The local stroke is drawn from
  pointer events directly and never waits on the 40 ms send rate.
- **Midpoint quadratic smoothing** (`quadraticCurveTo` through segment
  midpoints).
- **Tools**: marker (the tool stays armed), highlighter (α 0.3), an eraser
  that hit-tests strokes against their segments, and a laser pen. The laser
  is presence-only: points fade after 1.5 s and are never persisted.
- **Model**: a stroke stays a `freeform` shape element, so selection, move,
  group, undo, PDF and PPTX export keep working (FigJam treats marker
  strokes as objects too). A separate ink layer is worth revisiting only if
  boards accumulate thousands of strokes.

### Third pass: brainstorming and sketching (2026-11-17)

A three-way audit found gaps the roadmap below either missed or ordered
too late. It had three parts:

- FigJam research
- a code audit
- a hands-on session running an affinity-mapping retro and a wireframe
  sketch in the browser

The findings that drove this pass:

- **Sketching was blocked.** Scribble sat last in the Line picker with
  no key, dropped back to Select after every stroke, and took its colour
  only after drawing. A finger on empty canvas panned instead of
  drawing. Hit-testing used the stroke's padded bbox
  (`element-hit.ts`), so one diagonal stroke swallowed clicks on every
  sticky under it, and an eraser could not be built on it.
- **Brainstorming was blocked.**
  - There were no sections, so clusters could not be titled or moved
    together.
  - There were no stamps, votes, timer, cursor chat or board comments.
  - Repeated `S` stacked stickies on one another.
  - A pasted list did nothing.
- **Connectors broke clusters.**
  - A connector only glued when dropped exactly on a site.
  - Distribute moved connectors as if they were objects.
  - A connector could not carry a label.

The pass ships the roadmap's Phases 1 to 5, the second pass's B and C,
and the items the audit added, as one PR. § Shipped in the third pass
records what landed and where.

### Roadmap

Ordered by how much each phase removes from the gap a FigJam user feels,
weighed against its cost. Phases 1 to 3 are board-local or additive host
options. Phases 4 and 5 change the CRDT schema and need their own design
docs before they start.

**Phase 1: Sticky-first flow** (board-local)

- Add an adjacent sticky: Mod+Enter on a selected sticky, and a "+" handle
  on each side of a selected sticky (FigJam), both via `dropStickyAt` +
  `freeStickyCenter` in that direction.
- Cascade image inserts the same way. `insertImageOnSlide` needs the
  decoded size before placing, so the footprint test moves into it.
- Optional author tag on a sticky (FigJam's "show author"): a presence
  username written once at creation, rendered small at the bottom edge.

**Phase 2: A board tool dock** (frontend; slides untouched)

- Move the insert tools into a bottom-centre floating dock (FigJam, Miro),
  leaving the top bar for the view (zoom, grid) and the contextual
  controls. The dock is where a whiteboard user looks first. On a phone it
  is already the right shape.
- Curate the shape list to about 12 board shapes (rectangle, rounded
  rectangle, ellipse, diamond, triangle, parallelogram, arrows, star,
  speech bubble), with "More shapes" opening the full OOXML picker.
- Rename slides jargon on the board: Scribble to Marker, Elbow connector to
  Connector, Curved connector to Curved.

**Phase 3: Connect quickly** (additive editor options)

- Hover "+" arrows on a shape or sticky that create a connected copy in
  that direction (FigJam's quick-create), placed with `freeStickyCenter`'s
  stepping rule and glued with the existing connector sites.
- Connector labels: a text body on a connector, reusing the shape-text
  editor at the midpoint.

**Phase 4: Sections** (CRDT schema; needs a design doc)

- A titled container that moves and resizes with its children, and that
  Fit and the minimap can target. The Miro importer's best-effort `frame`
  becomes a real section. Open question: a new element type, or a group
  with a title and a frame. A group already carries children in local
  coordinates (`slides/slides-group.md`), but groups select as a unit and
  sections must not.

**Phase 5: Collaboration rituals** (CRDT + backend)

- Comments on the board through the shared comments module, anchored to
  an element or a world point. This is the PRODUCT.md promise "comments
  work the same way across every document type", currently broken for
  boards.
- Cursor chat and emoji reactions over the existing presence channel.
- Voting with stamps, and a shared timer: ephemeral presence state, not
  document state.

**Phase 6: Out of the board**

- Export the board (or a section) as PNG and PDF, reusing the offscreen
  `drawSlide` path the minimap and thumbnail already use.
- Paste a sheet range as a board table, which needs board table support
  (today `YorkieBoardStore` throws on table ops).
- A mobile board shell, following `slides/slides-mobile.md`.

### Risks and Mitigation

- **The shared engine is Slides' engine too.** The Esc change is the one
  deliberate behaviour change to Slides in this pass, and it moves Slides
  toward Google parity rather than away. *Mitigation:* every other change
  is a host option (`hostInsertMenuItems`, `presets`) that defaults to
  current Slides behaviour, and the roadmap keeps that rule.
- **Sticky identity is a heuristic.** `isStickyElement` reads the preset's
  signature (a `roundRect` with a solid fill and shrink-autofit text). A
  user who sets a plain rounded rectangle to shrink-autofit gets sticky
  controls. *Mitigation:* acceptable until Phase 4's schema work. At that
  point a real `role: 'sticky'` marker can be written at creation and on
  Miro import.
- **FigJam keys vs Google keys.** Where they collide, the Google behaviour
  stays (type-to-edit, Mod shortcuts) and the FigJam key is narrowed (§ Tool
  keys vs type-to-edit). Any new key needs the same check.
