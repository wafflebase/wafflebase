# Filter Sort — Column-Scoped Sorting

## Goal

Change `sortFilterByColumn()` to only move cells within the filter column
range, leaving cells outside the filter boundaries untouched (Google Sheets
behavior).

## Tasks

- [x] Replace `moveCells`-based row reordering with `getGrid`/`deleteRange`/`setGrid`
- [x] Build row mapping (`oldRow → newRow`) from sorted `desired` array
- [x] Scope cell read/write to filter column range only
- [x] Remove `skipFilterStateRemap` option from `moveCells` (no longer needed)
- [x] Add test: `does not move cells outside filter column range when sorting`
- [x] Verify existing filter tests still pass (14/14)
- [x] Update `design/sheet.md` Filter Model section with sort algorithm
- [x] Add Post-Task Checklist section to `CLAUDE.md`
- [x] Create task files and archive

## Review

All 531 tests pass. The implementation correctly scopes sorting to the filter
column range using `getGrid`/`deleteRange`/`setGrid` instead of whole-row
`moveCells`.
