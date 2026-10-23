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

The range moves by the number of cells the pointer has crossed since it
grabbed the border (grab offset preserved), and the move only starts once the
pointer travels past a small drag threshold. A click is therefore a no-op.

## Plan

- [x] `cellDragMoveDestination(source, anchor, pointer)` — source top-left
      shifted by `pointer - anchor`, clamped to row/column 1
- [x] Drag threshold (`CellDragMoveThreshold`, 4 CSS px) before the move
      cursor, preview and commit engage
- [x] Below the threshold, a release is an ordinary click: select the cell
      under the press
- [x] Primary button only — a right-click on the border goes to the
      context-menu path instead of starting a move
- [x] Unit tests for the destination math and the click/drag gesture
- [ ] `pnpm verify:fast`
- [ ] Self review
- [ ] PR
