# Slides live presence wiring — todo

Branch: `slides-live-presence`

## Goal

Close **Gap 3** of [slides-collaboration.md](../../design/slides/slides-collaboration.md):
the in-canvas peer presence is only half-wired. Today only `activeSlideId`
and `selectedElementIds` are *broadcast*, and `getPeers()` is **never
consumed** — nothing renders peer selection rings, live drag frames, or guide
previews. This task wires the consume side and the missing live-frame /
guide broadcasts so collaborators see each other editing.

Out of scope (separate PRs): Tree-backed text bodies (Gap 1/2), peer text
carets (`textCursor` + docs `peer-cursor.ts` reuse).

## Architecture

- The slides **editor** must stay presence-agnostic: `SlidesStore` (the
  interface it depends on) has no presence methods — those live only on the
  concrete `YorkieSlidesStore`. So:
  - **Broadcast**: drag/resize/rotate/guide gestures live *inside* the editor.
    The editor emits the in-progress world frames / dragging guide via **new
    editor events** (`onActiveFramesChange`, `onDraggingGuideChange`).
    `slides-view.tsx` (which holds the concrete store) calls
    `store.updatePresence(...)`, coalesced to rAF.
  - **Consume**: `slides-view.tsx` subscribes to peer presence changes
    (new `YorkieSlidesStore` `doc.subscribe("others", …)` seam), maps
    `SlidesPresence` → a presence-agnostic `PeerView`, and feeds the editor via
    a new `editor.setPeers(peers)` API. The editor's DOM overlay
    (`overlay.ts`) draws peer rings/frames/guides (filtered to the current
    slide), reusing its own scale + slide-offset transform.
- Peer colors reuse `getPeerCursorColor(theme, clientID)` from
  `@wafflebase/sheets` (already used by docs + the avatar stack).
- `PeerView` lives in the slides package (editor consumes it); it carries
  **world-space** frames so the overlay only needs to scale, never resolve
  group transforms at paint time.

## Pure seams to unit-test (TDD)

- `computePeerOverlays(peers, slide, currentSlideId, scale, worldFrameOf)` —
  slides package pure fn → list of `{ kind: 'ring'|'frame'|'guide', rect/line,
  color, label? }`. Filters to current slide; prefers a peer's `activeFrames`
  over its static `selectedElementIds` ring for the same element.
- `mapPresenceToPeerView(peers, theme)` — frontend pure fn: maps + assigns
  color + drops self / peers with no `activeSlideId`.

## Plan (staged commits, one PR)

### P1 — Consume: peer selection rings + labels (no new broadcast) ✅
- [x] Add `onPresenceChange(cb)` to `YorkieSlidesStore` (`doc.subscribe("others")`).
- [x] Add `PeerView` type + `editor.setPeers(peers)` API; repaints overlay.
- [x] `computePeerOverlays` pure fn + unit tests (slides package, 8 tests).
- [x] Render peer rings + username labels as DOM divs in `overlay.ts`
      (peer color, non-interactive: `pointer-events:none`).
- [x] Wire `slides-view.tsx`: subscribe → `mapPresenceToPeerView` → `setPeers`;
      also push peers on `store.onChange` and initial mount; dispose cleanly.
- [x] `mapPresenceToPeerView` pure fn + unit tests (frontend, 5 tests).

### P2 — Broadcast + render live drag/resize/rotate frames
- [ ] Emit `onActiveFramesChange(frames|null)` from drag, resize, rotate
      gestures (world frames during move; `null` on commit/cancel).
- [ ] `slides-view.tsx`: on change, stash frames; flush via `updatePresence`
      on the existing rAF tick (coalesced). Clear on `null`.
- [ ] Extend `computePeerOverlays` to draw live frames (prefer over rings).

### P3 — Broadcast + render guide drag preview
- [ ] Emit `onDraggingGuideChange(guide|null)` from ruler guide create/move.
- [ ] Broadcast `draggingGuide`; render peer guide line in overlay.

### Verify
- [ ] `pnpm verify:fast` green.
- [ ] Two-window manual smoke in `pnpm dev`: peer ring on selection, live frame
      on drag, guide preview on ruler drag; rings clear on blur/slide-change.
- [ ] Self code-review over the branch diff; address blocking findings.

## Notes / decisions log

- (fill in as implementation proceeds)

## Review

- (fill in at completion)
</content>
</invoke>
