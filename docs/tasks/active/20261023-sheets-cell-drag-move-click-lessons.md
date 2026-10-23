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
