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

- [x] Carry a point of the selection by the pointer's travel in sheet pixels
      (`carryPoint`): the top-left cell's centre for a move (since replaced
      by the grabbed point — see `20261025-sheets-drag-move-grab-point`), a point inset
      from the bottom-right corner for a fill. Two models were tried first:
      an index delta from the press cell (sent a drag into filter-hidden rows
      and across the freeze gap) and a viewport-pixel grab offset (a top-left
      cell scrolled out of view mapped to row 1 under freeze panes)
- [x] Drag threshold (`CellDragThreshold`, 4 CSS px) before the move
      preview and commit engage
- [x] Below the threshold, a release changes nothing — not the sheet, not the
      selection (first done as "select the cell under the press", which
      collapsed the selection to the neighbouring cell and contradicted the
      right-click rule)
- [x] Primary button only — a right-click on the border or fill handle keeps
      the selection, in both `handleMouseDown` and the frontend context menu
      (`Spreadsheet.isOnSelectionEdge`)
- [x] Same threshold and carry for the fill handle — its hit area reaches 8px
      into the neighbouring cells, so a click or twitch on its lower half
      filled one row; `detectAutofillHandle` honours `hideAutofillHandle`
- [x] Unit tests for the destination math and the click/drag gestures
- [x] `pnpm verify:fast`
- [x] Self review
- [ ] PR
