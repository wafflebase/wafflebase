# Sheet Find (Ctrl+F) — Task

## Goal
Implement text search (Find) in the spreadsheet with Google Sheets-style UX.

## Checklist

- [x] Step 1: Add `findCells()` method to `Sheet` model
- [x] Step 2: Add search highlight colors to theme (`searchHighlightColor`, `searchCurrentColor`)
- [x] Step 3: Add search highlight rendering to `Overlay` (both simple and freeze paths)
- [x] Step 4: Add `find/findNext/findPrevious/clearFind/getSearchState` to `Spreadsheet` API
- [x] Step 5: Create `FindBar` React component (`packages/frontend/src/components/find-bar.tsx`)
- [x] Step 6: Integrate into `SheetView` with `Ctrl/Cmd+F` shortcut
- [x] Step 7: Add unit tests for `findCells()` (6 tests)
- [x] Step 8: `pnpm verify:fast` passes (982 tests, 48 files)

## Files Changed

| File | Change |
|------|--------|
| `packages/sheet/src/model/sheet.ts` | `findCells()` method |
| `packages/sheet/src/view/theme.ts` | Search highlight colors |
| `packages/sheet/src/view/overlay.ts` | Search highlight rendering |
| `packages/sheet/src/view/worksheet.ts` | `setSearchHighlights()`, pass to overlay |
| `packages/sheet/src/view/spreadsheet.ts` | `find/findNext/findPrevious/clearFind/getSearchState` |
| `packages/frontend/src/components/find-bar.tsx` | New FindBar component |
| `packages/frontend/src/app/spreadsheet/sheet-view.tsx` | Ctrl+F shortcut + FindBar integration |
| `packages/sheet/test/sheet/find.test.ts` | 6 unit tests |

## Status: Complete
