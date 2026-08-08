# Board snap to grid (P2 — the grid's follow-up)

`Add a Miro-style background grid to the board canvas` (#722) shipped the
grid as display only and named its own follow-up:

> **Snap to grid is deliberately not part of this.** Miro keeps it a
> separate toggle too. It extends `snapDelta`
> (`slides/view/editor/snap.ts`) with grid candidates and carries a
> drag / resize / connector regression surface that display alone does not.

This is that pass.

## Background

The board reuses the slides editor unmodified. Two of its gestures place
geometry: the move drag (`startDrag` → `snapDelta`) and the resize drag
(`startResize` / `startMultiResize` → `resizeFrameWorld` + `matchSize`).
Neither knows anything about a grid, and neither should — a slide has no
grid. So the work is a seam, not a feature inside `@wafflebase/slides`.

The grid step is already computed board-side by `gridStep(zoom)`
(`app/board/board-grid.ts`): a 1-2-5 × 10^k ladder floored at 20 world
units, which is what the user actually sees painted on the host.

## Decisions

| Question | Decision |
| --- | --- |
| Step | The **visible** grid — `gridStep(zoom)`. Miro and Figma both snap to what is drawn; a fixed step would snap to invisible lines when zoomed out. |
| Priority vs. existing snaps | Element edge / guide / slide-centre **win**; the grid is the fallback. |
| Threshold | **None** — the grid quantizes. The nearest grid line is always within `step / 2`, so an 8-unit threshold would leave the toggle inert at low zoom (at zoom 0.25 the step is 80, so it would engage 20% of the time). |
| Gestures | Move + resize. Connector endpoints and rotation are out of scope. |
| `Grid: None` | Snap still applies. Two independent toggles, as in Miro — "I don't want the lines but I do want the alignment" has to be expressible. |
| Escape hatch | Hold **Alt/Option** to suspend grid snap for that frame. Shift is already taken (axis lock / aspect). |
| Feedback | No guide line. The grid is its own feedback, and a line drawn on every frame is noise. |
| State | `localStorage`, per user, independent of the grid mode — same reasoning as the grid mode itself (one collaborator must not change another's view). |
| Default | **Off**, unlike the grid display's `dot`. Drawing lines changes nothing about a board; snapping changes where every drag lands, and a Miro import's off-grid elements would jump the first time anyone nudged one. |

## Approach — the seam

Two additive `SlidesEditorOptions`. A slides mount passes neither, so its
behavior is bit-identical.

```ts
/** World-space grid step, or null when snapping is off. */
getSnapGrid?: () => number | null;
/** Extra items appended to the empty-canvas context menu. */
hostCanvasMenuItems?: () => ContextMenuItem[];
```

`getSnapGrid` is a callback, not a value, because the step depends on the
live zoom and the editor is constructed once.

`hostCanvasMenuItems` generalizes the existing bespoke `onFitToContent`
hook rather than adding a third one-off option. `ContextMenuItem.selected`
already draws a check-mark column, so a toggle item costs nothing.

Rejected alternatives:

- **A generic `snapAdjust(bbox, dx, dy)` post-processor.** It runs *after*
  `snapDelta`, so it would override edge snaps — it cannot express
  "grid loses to an element edge".
- **Quantize at commit only.** The ghost preview would show one position
  and the drop another.

## Tasks

- [x] `packages/slides/src/view/editor/grid-snap.ts` — new pure module
  - [x] `snapToGrid(value, step)` — nearest multiple
  - [x] `quantizeResizeFrame(frame, handle, step)` — round only the edges
        the handle moves, anchor edge fixed; no-op on a rotated frame
        (its edges are not axis-aligned, so a grid has no meaning for
        them) and on any axis where rounding would collapse the size
- [x] `snap.ts` — `snapDelta(..., grid?: number | null)`; per axis, when no
      edge/guide/centre candidate won, quantize the bbox's left/top edge.
      Emits no `SnapGuide`.
- [x] `editor.ts`
  - [x] The two options above
  - [x] `startDrag`: `ev.altKey ? null : getSnapGrid()` into `snapDelta`
  - [x] `startResize` / `startMultiResize`: quantize after `matchSize`,
        skipped when a size guide matched, when Shift is held (it means
        "preserve aspect", which rounding would break), or when Alt is
  - [x] `canvasContextItems`: append `hostCanvasMenuItems()`
- [x] `board-grid.ts` — `loadGridSnap()` / `saveGridSnap()`
- [x] `board-view.tsx` — `gridSnap` state + ref, `getSnapGrid`, the
      `Snap to grid` context-menu item
- [x] `board-toolbar.tsx` — checkbox item under the mode radio group
- [x] Tests: `grid-snap.test.ts`, `snap.test.ts` additions,
      `board-grid.test.ts` persistence
- [x] `docs/design/board/board.md` — replace the "not part of this"
      paragraph with what shipped
- [x] `pnpm verify:fast`
- [ ] Browser smoke

## Known limitations

- A position taken while zoomed out can look off against the finer grid
  drawn when zoomed in. The 1-2-5 ladder makes the coarse steps multiples
  of the fine ones in most, not all, transitions (5 → 2 is not).
- Rotated elements do not grid-snap on resize (see above). They still
  grid-snap on move, where the frame's x/y is the axis-aligned position
  the user drags.
- The arrow-key nudge does not grid-snap. Miro steps by one cell there;
  we keep nudge as the fixed 1 / 10-unit escape from whatever the
  surrounding geometry is, so the first press does not jump.
- `startResize`'s `onUp` commits unconditionally, so clicking a handle
  and releasing pushes an undo entry that writes the frame back
  unchanged. Pre-existing (`startMultiResize` has the guard,
  `startResize` never did) and untouched here — the grid's movement gate
  means the entry is a no-op in value, as it was before.

## Review

All tasks above done except the browser smoke; `pnpm verify:fast` green
(exit 0).

**Code review** (dispatched over the full branch diff)

No Critical findings. The reviewer traced the `startMultiResize`
refactor branch by branch and confirmed it preserves existing behavior,
verified the lattice matches what `gridBackgroundStyle` paints (including
the negative half-plane), and confirmed the trailing `snapDelta`
parameter breaks no caller.

Applied:

- **The movement gate.** The blocker: `startDrag` / `startResize` arm on
  pointerdown with no threshold, and the grid — alone among the snaps —
  returns a non-zero correction for a zero-length delta, so a stray
  `pointermove` inside a select-click committed a batch and moved an
  off-grid element by up to half a step. `activeSnapGrid` now takes a
  `moved` flag, fed from `peakRawClientDist` (drag) and a new
  `peakClientDist` (both resize paths) against the existing
  `SLOW_DOUBLE_CLICK_MAX_DISTANCE_PX`, so the two click-classification
  rules cannot disagree.
- **Per-axis equal-size suppression.** `matchSize` emits per-axis
  guides, but `gridSizedFrame` took a single boolean — a matched width
  disabled grid snapping on the height too. It now takes the matched
  axes and restores only those.
- Tests for all three untested paths the reviewer named: multi-selection
  resize (the branch this change restructured), the click/tremor gate on
  both move and resize, and per-axis suppression.
- Toolbar icon no longer dims on `None` when snap is on — that
  combination is supported, and the icon was the one always-visible
  affordance claiming the grid was inert.
- Doc corrections: smart guides can pull an axis back off the lattice
  (they run after `snapDelta`); Alt is sampled per frame, not per
  gesture; the arrow-key nudge is an explicit exclusion; the gate itself
  is documented.
- Moved the `activeSnapGrid` docblock back onto `activeSnapGrid` — it
  had ended up stacked above `gridSizedFrame`'s.

Not applied:

- **A no-op guard on `startResize`'s `onUp`.** Real (clicking a handle
  pushes an empty undo entry) but pre-existing and unrelated to the
  grid; recorded above instead of widening this change.
