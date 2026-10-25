# Sheets drag-move: carry the grabbed point, not the top-left centre

Follow-up to #1105. Dragging a selection by its border barely moved when the
grabbed cell was large and its neighbours small: the carried point was the
top-left cell's centre, so a 200px-tall cell over 20px rows needed 100px of
travel (five rows on screen) before the range stepped once.

## Plan

- [x] Reproduce with failing gesture tests (tall cell / wide cell / tall top-left in a multi-row range)
- [x] Add `carryRange`: clamp the press 2px inside the selection, move the range by the cells that point crosses
- [x] Switch `startCellDragMove` to it; drop the now-unused `cellCentre`
- [x] Fix test coordinates to include the headers (absolute press position now matters)
- [x] Update `docs/design/sheets/sheet.md` § Cell drag-move
- [x] `pnpm verify:fast`
- [x] Manual check in `pnpm dev` (by the user)
- [ ] Self review, PR

## Review

Behaviour change: the range steps as soon as the pointer passes the grabbed
border by ~2px (after the 4px drag threshold). Excel instead waits for the
next gridline when the press landed on the outer half of the border band.
