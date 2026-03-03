# Context Menu Selection UX Refinement

## Summary
Fix right-click context menu to preserve existing selection when right-clicking
inside it, and fix mobile long-press to select the target cell.

## Tasks

- [x] worksheet.ts: Skip cell selection on right-click inside existing range
- [x] worksheet.ts: Add right-click guard for row/column header selections
- [x] sheet-context-menu.tsx: Add cell-level within-selection check
- [x] use-mobile-sheet-gestures.ts: Select cell on long-press before dispatching contextmenu
- [x] Verify `inRange` is already exported from `@wafflebase/sheet`
- [x] Run `pnpm verify:fast` — all tests pass

## Review

All changes are minimal and focused:
- worksheet.ts: Added `inRange` import and 3 guards (grid cells, column headers, row headers)
- sheet-context-menu.tsx: Added cell-level within-selection check in `handleContextMenu`
- use-mobile-sheet-gestures.ts: Added cell selection before synthetic contextmenu dispatch
