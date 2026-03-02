# Mobile Row/Column Operations — Lessons

## Spreadsheet API Surface

- The `Spreadsheet` class didn't expose `selectRow`, `selectColumn`,
  `insertRows`, `deleteRows`, `insertColumns`, `deleteColumns`, or
  `getSelectedIndices` — these were only on the internal `Sheet` model.
  Added public delegating methods on `Spreadsheet` that render and notify
  selection change callbacks after the operation.

## Header Hit Test

- Added `headerHitTest(clientX, clientY)` to both `Worksheet` and
  `Spreadsheet` classes. It converts client coordinates to viewport-relative
  coordinates and checks against `DefaultCellHeight` (23px) and
  `RowHeaderWidth` (50px) thresholds. This keeps layout constants internal
  to the sheet package.

## Preventing Synthesized Mouse Events

- After a long-press fires on mobile, the browser still synthesizes a
  `mousedown` event when the finger lifts. Without prevention, this
  synthesized event would trigger `Worksheet.handleMouseDown`, change the
  selection, and dismiss the context menu.
- Solution: track a `longPressFired` flag in the gesture hook. On
  `touchend`, if `longPressFired` is true, call `e.preventDefault()` to
  suppress the synthesized mouse event.
- Similarly, when a header tap is detected, `preventDefault()` on touchend
  prevents the synthesized mousedown from double-processing the selection.

## Context Menu Design

- Extended `MobileContextMenu` with a `menuType` prop instead of creating
  separate components. Three item builders (`buildCellItems`,
  `buildRowItems`, `buildColumnItems`) keep the rendering logic unified
  while varying the menu content.
- Row/column operations use dedicated Tabler icons (`IconRowInsertTop`,
  `IconRowInsertBottom`, `IconColumnInsertLeft`, `IconColumnInsertRight`)
  for clear visual distinction from cell operations.
