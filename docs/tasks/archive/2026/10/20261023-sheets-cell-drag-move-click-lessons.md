# Lessons: Sheets cell drag-move on click

- A hit band that straddles an edge puts half of its presses in the
  neighbouring cell. Any drag that reads "the cell under the pointer" from
  such a band has to be relative to the press, or gated by a drag threshold,
  or a click mutates. The fill handle had the same defect as the border.
- `startMouseDragSession` completes on mouseup whether or not the pointer
  moved; every mutating drag built on it needs its own "did it actually drag"
  check.

## Self review

- Round 0 (did not run): `scripts/agent/node_modules` was stale and lacked
  `@anthropic-ai/claude-agent-sdk`; every lens failed to load. `npm ci`, then
  `--fresh`.
- Round 1: design-fit — the click fallback skipped `primeCellInputForSelection()`
  (fixed: same tail as the plain-click path). blast-radius — the fill-handle
  branch had no `e.button === 0` guard and committed a fill on a click with no
  drag (fixed: guard + the shared drag threshold, with tests).
- Round 2: blast-radius — once a right-click no longer started a drag, it fell
  through to the generic right-click path, where the border band resolves to a
  cell outside the selection, so the selection collapsed before the context menu
  (fixed: a right-click on the border or fill handle keeps the selection).
  test-adequacy — the `e.button === 0` guards were untested (fixed: mousedown
  tests for the left/middle/right buttons). Minor: priming now matches each
  modifier path, and the two design-doc passages were updated. Disputed: the
  round-1 autofill finding was carried forward with pre-fix evidence; 3780bed5a
  fixed it (rebuttal cites the `dragging` gate and its tests).
- Round 2 code review (`superpowers:requesting-code-review`, independent
  subagent): the index-delta destination sent a drag into filter-hidden rows
  (zero-height rows sit between the press cell and the source) and across the
  freeze gap (it maps to the first unscrolled row — a 5px drag moved B49 to
  B96). Fixed by measuring the grab offset in pixels from the top-left cell's
  centre. It also found the right-click fix was undone by the frontend's
  `contextmenu` handler re-selecting `cellRefFromPoint`; fixed with a public
  `Spreadsheet.isOnSelectionEdge` used by both.
- Round 3: rebuttal of the carried-forward autofill finding overturned.
  correctness — a sub-threshold left-click selected the cell under the press,
  collapsing the selection to the neighbouring cell, contradicting the
  right-click rule (fixed: a click on the border is a no-op, Excel parity;
  the copied click-selection code is gone).
- Round 3 reviewed the commit before the pixel-offset rework, so a round 4
  was run with `--force` on the reworked branch.
- Lesson: an index-space shortcut is only valid when indices and pixels are
  monotonic together. Hidden rows and freeze panes break that, and a stand-in
  grid with uniform rows cannot show it — test with a grid that has both.
- Round 4 (`--force`): correctness — the viewport-pixel carry mapped a
  top-left cell scrolled out of view to row 1 under freeze panes (the point
  fell in the frozen branch of `toRefWithFreeze`); the fill handle still used
  the raw pointer cell, so a 4px twitch filled a neighbour. blast-radius —
  `detectAutofillHandle` ignored `hideAutofillHandle`, so the new
  `isOnSelectionEdge` claimed right-clicks over an undrawn handle on mobile.
  Fixed all three by carrying in sheet space (`carryPoint` over
  `DimensionIndex`) for both gestures, insetting the fill's carried corner by
  the handle's hit reach, and honouring `hideAutofillHandle` in the hit test.
- Lesson: three coordinate spaces are in play (viewport CSS px, unzoomed
  viewport, sheet). Freeze panes make viewport → ref non-monotonic, so a
  carried point must be resolved in sheet space, where only `findIndex` runs.
- Panel round 5 (CI review panel): correctness — `beginSheetTravel` still
  assumed a single affine screen→sheet mapping (`Δpx / zoom + Δscroll`),
  which only holds in the scrollable quadrant, so a frozen-pane range drifted
  with auto-scroll and a drag across the freeze gap missed the
  discontinuity; and `cellCornerInset` subtracted a flat 8px, putting the
  anchor in the previous cell when the boundary column was narrower than the
  handle's reach (or hidden), filling backwards at rest. Fixed by computing
  travel as the difference of two `toSheetPointFromMouse` points (the same
  per-pane arithmetic `toRefFromMouse` uses) and capping the inset at the
  cell's own size.
- Lesson: "work in sheet space" was the right call but half-applied — the
  *conversion into* sheet space is itself pane-dependent. A travel vector is
  only pane-free once both of its endpoints went through the same freeze-aware
  mapping; subtracting raw pixels and adding `Δscroll` silently re-introduces
  the scrollable quadrant's assumptions.

## Round 4 — panel fixes (per-pane travel fallout)

- **Auto-scroll assumed travel always carried Δscroll.** The per-pane travel
  from round 3 broke the two auto-scroll loops: when the pointer is clamped
  into a frozen band (which is exactly where it lands when auto-scroll
  engages at the top or left edge of a freeze), the carried target no longer
  responds to scrolling, so the loop scrolled the grid forever under a
  preview standing still. `dragAutoScrollVelocity` now holds the axis that is
  frozen, and `inFrozenPanes` is the one quadrant test the mapping and the
  scrolling share — the mapping and the thing that feeds it cannot disagree
  about which pane the pointer is in.
- **Capping the inset was not enough for a hidden boundary cell.** A
  zero-size cell has no interior, so no point resolves to it: `findIndex`
  answers the *next* visible index, and the drag started one cell on — past
  the drop-in-place no-op guard, onto a neighbour the user never dragged to.
  Clamping the point can't fix what has no interior; counting indices
  instead does. `carryPoint` now takes the anchor ref and returns
  `anchor + (findIndex(point + travel) - findIndex(point))`, which is
  identical for every cell with an interior and keeps zero travel at the
  anchor for one without.

## Round 5 — panel fixes (index counting, both directions)

- **A collapsed run is a boundary, and a boundary has two sides.** Round 4's
  `anchor + (findIndex(point + travel) - findIndex(point))` fixed the
  forward direction and broke the backward one: for a hidden anchor the base
  term resolves *past* the whole run, so the first pixel of upward travel
  subtracted the run's length at once — a drag-move that overwrites row 1
  from a 4px nudge. The base now reads the side the pointer is heading for
  (`point - BoundaryProbe` going back), which is the only reading under
  which the function is continuous at zero travel in both directions.
- **Counting indices gives up an invariant resolving an offset provided for
  free.** `DimensionIndex.findIndex` can never answer a zero-size index, so
  until round 4 every destination handed to `moveRangeTo`/`autofill` — which
  validate nothing — was a cell the user could see. A count off a hidden
  anchor can land inside the run, so the result is snapped back onto a drawn
  cell. The anchor itself is exempt: that *is* the drop-in-place no-op.
