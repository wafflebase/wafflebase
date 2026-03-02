# Mobile Row/Column Operations

Provide mobile-friendly UI for inserting and deleting rows and columns.

## Context

Desktop users right-click row/column headers for insert/delete operations.
Mobile users have no equivalent interaction path. This task adds header tap
selection and a long-press context menu with insert/delete actions.

Resize is deferred to a future milestone.

## Design

### Interaction Flow

1. User taps a row/column header on mobile
2. Spreadsheet selects the entire row/column (`selectRow`/`selectColumn`)
3. User long-presses → context menu appears
4. Menu shows row/column-specific actions based on `selectionType`
5. User taps an action → operation executes

### Changes

- **`use-mobile-sheet-gestures.ts`**: Detect header taps, call
  `selectRow()`/`selectColumn()` on the spreadsheet
- **`MobileContextMenu`**: Accept `menuType` prop (`cell | row | column`);
  show Insert above/below + Delete for rows, Insert left/right + Delete for
  columns
- **`sheet-view.tsx`**: Read `selectionType` from spreadsheet and pass as
  `menuType` to MobileContextMenu
- **Spreadsheet API**: Already has `insertRows`, `deleteRows`,
  `insertColumns`, `deleteColumns` — wire directly

### Menu Items

**Row selected:**
- Insert 1 row above
- Insert 1 row below
- Delete row

**Column selected:**
- Insert 1 column left
- Insert 1 column right
- Delete column

## Tasks

- [x] Detect header tap in mobile gestures and select entire row/column
- [x] Add `menuType` prop to MobileContextMenu with row/column menu items
- [x] Wire SheetView to pass selectionType and row/column operation callbacks
- [x] Add visual regression baseline for row/column context menu
- [x] Run `pnpm verify:fast` and confirm pass
