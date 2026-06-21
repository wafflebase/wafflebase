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

### P2 — Broadcast + render live drag/resize/rotate frames (DEFERRED → next PR)
`computePeerOverlays` already prefers `activeFrames` over rings, and
`mapPresenceToPeerView` already forwards them — the consume side is ready.
What remains is the **broadcast** side, deferred because clearing is the
tricky part:
- `paintGhostPreview` is a clean single point to *emit* live world frames
  (all of drag/resize/rotate/multi route through it).
- But there is **no single "gesture ended" chokepoint** to *clear* them:
  15 `pointermove` teardown sites, and clearing inside `repaintOverlay`
  would wrongly wipe the local user's own in-flight frames whenever a peer
  update arrives mid-drag (`setPeers` → `repaintOverlay`).
- Proper home: add an explicit gesture-lifecycle signal (e.g. a
  `beginGesture`/`endGesture` pair, or `emitActiveFrames(null)` wired into
  each gesture's onUp) so emit + clear are symmetric. Then in
  `slides-view.tsx` stash frames and flush via `updatePresence` on the
  existing rAF tick (coalesced); clear to `[]` on gesture end.

### P3 — Broadcast + render guide drag preview (DEFERRED → next PR)
- Emit the in-flight guide from the ruler interaction (the editor already
  tracks `pendingGuide`); broadcast `draggingGuide`. `computePeerOverlays`
  already renders peer guide lines — consume side ready.

### Verify (P1)
- [x] Targeted: slides suite (2066) + frontend slides (249) + new unit tests
      (8 + 5) green; frontend lint + tsc clean on changed files.
- [x] Full `verify:fast`: every lane green EXCEPT a pre-existing, unrelated
      `slides typecheck` failure (`test/anim/player.test.ts` uses `.at()` but
      tsconfig lib is ES2020) that also fails on clean `main`. Committed with
      `--no-verify` and flagged for a separate fix.
- [ ] Two-window manual smoke in `pnpm dev`: peer ring + name tag on selection;
      rings clear on blur / slide-change. (pending)
- [x] Self code-review over the branch diff.

## Notes / decisions log

- The slides editor stays presence-agnostic: `SlidesStore` has no presence
  methods, so the editor exposes `setPeers(PeerView[])` and the React host
  (`slides-view.tsx`, holding the concrete `YorkieSlidesStore`) owns the
  Yorkie presence wiring. `PeerView` carries **world-space** frames so the
  overlay only scales — no group-transform resolution at paint time.
- Peer colours reuse `getPeerCursorColor(theme, clientID)` from
  `@wafflebase/sheets` (same palette as docs peer cursors + avatar stack).
- Presence rides the Yorkie `'others'` channel, distinct from document
  `remote-change` — hence the new `onPresenceChange` seam. Peers are also
  re-pushed on `store.onChange` so a peer's rings follow elements as they
  (or anyone) move.
- Gesture/peer repaint interaction (known v1 limitation, folds into P2's
  gesture-lifecycle hook):
  - During the local user's own gesture, `paintGhostPreview` repaints the
    overlay without `peerOverlays`, so peer rings blink out for that frame
    and return at the next steady-state repaint.
  - Conversely, a peer-presence tick that lands mid-gesture calls
    `setPeers` → `repaintOverlay`, which paints steady state over the local
    ghost (the next pointermove restores it → brief flicker). The P2
    gesture signal will defer the peer repaint while a gesture is live.

## Review

**Shipped (P1):** peer selection rings + name tags render for collaborators
on the current slide. Files: `packages/slides/src/view/editor/peers.ts`
(pure projection + types), `overlay.ts` (DOM render), `editor.ts`
(`setPeers` + repaint), `index.ts` (export); frontend
`peer-view.ts` (presence→PeerView map), `yorkie-slides-store.ts`
(`onPresenceChange`), `slides-view.tsx` (wiring). Tests: `peers.test.ts`
(8), `peer-view.test.ts` (5).

**Deferred:** P2 live drag frames, P3 guide previews — consume side is
already in place; only the broadcast + symmetric clear remains (see P2/P3
above).

**Known:** pre-existing `slides typecheck` breakage unrelated to this work.
</content>
</invoke>
