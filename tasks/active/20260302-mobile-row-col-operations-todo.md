# Mobile Row/Column Operations

Provide mobile-friendly UI for inserting, deleting, and resizing rows and
columns.

## Context

Desktop users right-click row/column headers for insert/delete operations
and drag header borders to resize. Mobile users have no equivalent
interaction path for these structural editing operations.

## Tasks

- [ ] Detect tap on row/column header area on mobile
  - Select entire row/column on tap
- [ ] Show action bar or context menu for selected row/column
  - Insert above/below (row) or left/right (column)
  - Delete row/column
  - Resize option (or drag handle on header border)
- [ ] Implement row/column resize via drag on header edges
  - Visual feedback: resize indicator line during drag
  - Minimum size constraints
- [ ] Wire operations to existing spreadsheet model APIs
- [ ] Handle edge cases: frozen panes, merged cells in affected range
- [ ] Run `pnpm verify:fast` and confirm pass
