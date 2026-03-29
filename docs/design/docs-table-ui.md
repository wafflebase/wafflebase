---
title: docs-table-ui
target-version: 0.4.0
---

# Docs Table Frontend UI & IME Support

## Summary

Add frontend UI for table operations in Wafflebase Docs: a toolbar grid
picker for table insertion, a context menu for table cell operations, and
IME composition routing for table cells. All table engine methods already
exist in the EditorAPI — this work connects them to the user interface.

## Goals

- Grid picker (10x10) in the toolbar for table insertion
- Right-click context menu with full table operations when cursor is in a cell
- IME (Korean/Japanese/Chinese) input working inside table cells

## Non-Goals

- Table toolbar appearing when cursor enters a table (future)
- Cell range selection UI (future)
- Column resize drag handles (future)

## 1. Table Insert Button — Toolbar Grid Picker

### Component: `TableGridPicker`

A 10x10 grid of small squares rendered inside a Radix `DropdownMenuContent`.
Mouse hover highlights the selected region (top-left to hovered cell).
Bottom label shows dimensions (e.g., "3 x 4"). Click calls
`onSelect(rows, cols)`.

```typescript
interface TableGridPickerProps {
  onSelect: (rows: number, cols: number) => void;
}
```

**Behavior:**
- 10x10 grid of 20px squares with 2px gap
- Hover: cells from (0,0) to (hoverRow, hoverCol) highlighted in blue
- Click: fires `onSelect(hoverRow + 1, hoverCol + 1)`, closes dropdown
- Label below grid: "3 x 4" or "Insert table" when no hover

**Integration in `DocsFormattingToolbar`:**
- New table icon button (`IconTable` from `@tabler/icons-react`) after the
  existing list/indent group, before undo/redo
- Wrapped in `DropdownMenu` — trigger is the icon button, content is
  `TableGridPicker`
- On select: `editor.insertTable(rows, cols)`

### File

- Create: `packages/frontend/src/app/docs/table-grid-picker.tsx`
- Modify: `packages/frontend/src/app/docs/docs-formatting-toolbar.tsx`

## 2. Table Context Menu

### Component: `DocsTableContextMenu`

A Radix `ContextMenu` that wraps the docs editor container. Shows
table-specific operations when right-clicking inside a table cell.

**Menu items:**

| Group | Items |
|-------|-------|
| Row | Insert row above, Insert row below |
| Column | Insert column left, Insert column right |
| Delete | Delete row, Delete column |
| Merge | Merge cells, Split cell |
| Style | Cell background color (submenu with color grid) |
| Table | Delete table |

**Behavior:**
- On `onContextMenu`, check `editor.isInTable()`:
  - If true: show table context menu, prevent default
  - If false: allow default browser context menu
- "Split cell" is disabled when current cell has no merge
  (colSpan/rowSpan are both 1 or undefined)
- "Merge cells" will merge just the current cell with adjacent — for
  full multi-cell merge, cell range selection is needed (future)
- Cell background color uses the same 5-column color palette as the
  existing highlight color picker in the toolbar
- "Delete table" calls `editor.getDoc().deleteBlock(blockId)` to remove
  the entire table block

**Integration:**
- Wrap the editor container `<div>` in `DocsView` with `<ContextMenu>`
- Pass `editor` as prop to the context menu content component

### Files

- Create: `packages/frontend/src/app/docs/docs-table-context-menu.tsx`
- Modify: `packages/frontend/src/app/docs/docs-view.tsx`

## 3. IME Table Cell Routing

### Problem

The IME composition handlers (`handleCompositionStart`,
`handleCompositionEnd`, `handleInput` during composition) in
`packages/docs/src/view/text-editor.ts` use `doc.insertText()` / `doc.deleteText()` which
operate on block-level inlines. When cursor is in a table cell, these
must route to `doc.insertTextInCell()` / `doc.deleteTextInCell()`.

### Changes

In each of the three handlers, add a branch at the text operation point:

```typescript
// Pattern: check cellAddress before text operations
const ca = this.cursor.position.cellAddress;
if (ca) {
  this.doc.insertTextInCell(blockId, ca, offset, text);
} else {
  this.doc.insertText({ blockId, offset }, text);
}
```

Specific changes:

1. **`handleCompositionStart`**: Store `cellAddress` in
   `composition.startPosition` (already stores blockId + offset)

2. **`handleCompositionEnd`**: When deleting old composed text and
   inserting final text, use cell variants if `startPosition` has
   `cellAddress`

3. **`handleInput` (composition active)**: When replacing preview text,
   use cell variants if `composition.startPosition` has `cellAddress`

4. **Hangul assembler fallback**: The software Hangul assembler path also
   needs cell routing for the same insert/delete operations

### File

- Modify: `packages/docs/src/view/text-editor.ts`

## Risks and Mitigation

| Risk | Mitigation |
|------|------------|
| Grid picker positioning on small screens | DropdownMenu uses Radix Portal, auto-positions |
| Context menu conflicts with browser default | Only prevent default when isInTable() is true |
| IME edge cases in table cells | Existing IME test infrastructure covers composition flow; add cell-specific manual testing |
| "Merge cells" without multi-cell selection | Disable for now; enable when cell range selection is added |
