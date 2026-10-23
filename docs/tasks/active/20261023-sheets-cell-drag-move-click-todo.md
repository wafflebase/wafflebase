# Sheets: a click on the selection border must not move cells

People keep moving cells by accident. Pressing the selection border and
releasing without moving moves the range one cell (down for the bottom
border, right for the right one, and so on).

## Cause

- `startCellDragMove` used the cell under the pointer as the destination's
  top-left. The border hit band (`CellEdgeHitThreshold`, ±2px) straddles the
  edge, so its outer half lies in the neighbouring cell — the destination is
  already one cell away before the pointer moves. A multi-cell range jumps
  further: grabbing the bottom edge of `A1:A5` puts its top-left at `A6`.
- `startMouseDragSession` calls `onComplete` on mouseup even with no
  mousemove, so that destination is committed by a plain click.

## How Excel / Google Sheets avoid it

The range travels with the pointer, keeping the grab offset, and the move
only starts once the pointer travels past a small drag threshold. A click on
the border is therefore a no-op (Excel leaves the selection alone too).

## Plan

- [x] Grab offset in pixels (`cellDragGrabOffset`, from the top-left cell's
      centre), destination = cell under `pointer - offset`, clamped to
      row/column 1. An index delta was tried first and sent a drag into
      filter-hidden rows or across the freeze gap
- [x] Drag threshold (`CellDragThreshold`, 4 CSS px) before the move
      preview and commit engage
- [x] Below the threshold, a release changes nothing — not the sheet, not the
      selection (first done as "select the cell under the press", which
      collapsed the selection to the neighbouring cell and contradicted the
      right-click rule)
- [x] Primary button only — a right-click on the border or fill handle keeps
      the selection, in both `handleMouseDown` and the frontend context menu
      (`Spreadsheet.isOnSelectionEdge`)
- [x] Same threshold for the fill handle — its hit area reaches 8px into the
      neighbouring cells, so a click on its lower half filled one row
- [x] Unit tests for the destination math and the click/drag gestures
- [x] `pnpm verify:fast`
- [x] Self review
- [ ] PR
