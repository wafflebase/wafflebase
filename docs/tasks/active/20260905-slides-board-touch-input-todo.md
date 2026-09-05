# Slides & Board touch input parity

Close the gap between the mouse interaction model and what a finger can
actually reach in the slides editor and the board canvas.

Audit summary (evidence gathered before any code changed):

| Area | State before this task |
| --- | --- |
| Slides `< 768px` | Touch shell exists (`mobile-slides-view.tsx`): 22px handle tolerance, `touch-action: none`, iOS callout suppressed |
| Slides `>= 768px` | Desktop mount. No handle tolerance, no `touch-action` — the `overflow: auto` scroll host steals one-finger drags |
| Board (all widths) | No touch handling at all. Pan is space-drag / middle-drag / wheel only, and `touch-action: none` also kills the browser's own pan |
| Sheets (reference) | Already ships pan / pinch / double-tap / long-press (`use-mobile-sheet-gestures.ts`) |

## Parts

### Part 1 — Input kind, not viewport width

`useIsMobile()` keys on viewport width (768px), so an iPad, an Android
tablet, and a phone in landscape all take the desktop mount and lose
every touch accommodation.

- [x] `use-coarse-pointer.ts`: `matchMedia('(pointer: coarse)')` hook +
      a non-React `isCoarsePointer()` for imperative mounts
- [x] Slides desktop mount passes `touchHandleTolerance` on coarse input
- [x] Slides scroll host sets `touch-action: none` on the canvas on
      coarse input so a drag is not stolen as a scroll
- [x] Board mount passes `touchHandleTolerance` on coarse input

### Part 2 — Pointer-calibrated drag thresholds

`DRAG_THRESHOLD_PX = 3` is a mouse number. Finger jitter is 5–10px, so
a tap becomes a drag and nudges the element.

- [x] Per-pointer-type threshold (mouse 3, touch/pen 10)
- [x] Slow-double-click text entry disabled for non-mouse pointers
      (its 3px/350ms window is unreachable by finger; `dblclick` is the
      touch path)

### Part 3 — Multi-touch guard

- [x] `onPointerDown` ignores non-primary pointers, so a second finger
      never starts a second selection/drag/lasso gesture

### Part 4 — Board touch navigation

The headline defect: a board cannot be panned or zoomed by touch.

- [x] `board-touch-gestures.ts`: one-finger pan on empty canvas,
      two-finger pan + pinch zoom anchored at the gesture midpoint
- [x] Wired through the existing `commitViewport` chokepoint
- [x] Capture-phase interception so a pan never also lassos

### Part 5 — Reachable context menu on touch

- [x] Editor-level long-press (500ms / 10px, matching the sheets
      constants) instead of relying on the browser's `contextmenu`,
      which iOS suppresses under `-webkit-touch-callout: none`
- [x] Menu rows meet the 44px touch target on coarse input

### Part 6 — Presentation mode touch navigation

- [x] Swipe left/right for next/previous
- [x] Tap zones: left third = previous, rest = next

### Part 7 — Board toolbar touch targets

- [x] Coarse-pointer sizing for the toolbar controls (32px/24px/20px
      controls today)

## Verification

- [x] `pnpm verify:fast`
- [x] Unit tests per part
- [ ] Manual smoke on a coarse-pointer emulation

## Non-goals (called out, not silently dropped)

- A dedicated mobile board shell / mobile board toolbar — a new surface,
  not a gap in an existing one.
- A selection action bar compensating for lost hover affordances — real
  UI design work, tracked separately.
- Lasso multi-select, adjustment diamonds, shape insert, theme/layout
  panels on the mobile slides shell — already listed as Non-Goals in
  `docs/design/slides/slides-mobile.md`.
