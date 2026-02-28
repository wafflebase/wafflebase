# Column/Row Hide/Show Feature

## Plan

Add manual hide/show for rows and columns, separate from filter-hidden rows.

## Implementation

- [x] Phase 1: Data Model & Store — HiddenState type, Store interface, MemStore, Sheet model
- [x] Phase 2: View Layer — Column hiding via syncHiddenColumnsFromSheet
- [x] Phase 3: Navigation — skip hidden rows/columns in move/moveToEdge/resizeRange
- [x] Phase 4: Context Menu — hide/show items for rows and columns
- [x] Phase 5: Header Visual Indicators — colored markers at hidden boundaries
- [x] Phase 6: Yorkie Persistence — hiddenRows/hiddenColumns in worksheet type and YorkieStore
- [x] Phase 7: Tests — 17 tests covering all scenarios
- [x] Post-task: verify:fast passes (548 tests, all green)

## Review

All phases implemented. Key design decisions:
- Filter-hidden (`hiddenRows`) and user-hidden (`userHiddenRows`/`userHiddenColumns`) are separate sets
- `getHiddenRows()` returns the union, `clearFilter()` does not affect user-hidden
- Navigation uses `isRowHidden()`/`isColumnHidden()` helpers to check both
- Hidden state persists via `HiddenState` type through Store abstraction
- Visual indicators use colored bars in headers at hidden boundaries
