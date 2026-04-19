---
title: docs-table-copy-paste
target-version: 0.3.5
---

# Docs Table Copy-Paste

## Summary

Enable copy-paste for tables in the Docs editor across three scenarios, implemented in phases:

1. **Cell-to-cell** — copy a cell range within a table, paste into the same or another table
2. **Whole-table block** — copy a region that includes table blocks, paste as new table blocks
3. **External HTML tables** — paste tables from Google Docs, Sheets, or the web

This document covers Phase 1 (cell-to-cell).

## Goals / Non-Goals

**Goals:**
- Copy a selected cell range and paste it into a target table, preserving cell content (blocks, inline styles)
- Reuse existing `tableCellRange` selection and `getSelectedText()` for plain-text fallback
- Keep changes minimal — extend existing clipboard infrastructure, don't rewrite it

**Non-Goals:**
- Auto-expanding the target table when pasted data exceeds bounds (clamp instead)
- Copying/pasting cell merge (colSpan/rowSpan) attributes in Phase 1
- External HTML table parsing (Phase 3)
- Undo/redo integration beyond existing `saveSnapshot()` mechanism

## Proposal Details

### Clipboard Payload Extension

Extend `ClipboardPayload` with an optional `tableCells` field:

```typescript
interface ClipboardPayload {
  version: 1;
  blocks: Block[];
  tableCells?: TableCell[][]; // rows × cols, present when copying a cell range
}
```

When `tableCells` is present, the payload represents a cell-range copy. When absent, it is a regular block copy. `blocks` remains `[]` for cell-range copies.

**Files:** `clipboard.ts` — update `serializeBlocks()` and `deserializeBlocks()` to accept/return the optional `tableCells` field.

### Copy Flow

In `handleCopy` and `handleCut`, add a branch before the existing `getSelectedBlocks()` call:

```
if selection has tableCellRange:
  1. Look up the table block by tableCellRange.blockId
  2. Extract cells from start to end (inclusive) as TableCell[][]
  3. Deep-clone each cell: regenerate block IDs, copy blocks/inlines/styles
  4. Serialize with tableCells field → set as WAFFLEDOCS_MIME
  5. Use existing getSelectedText() for text/plain (already tab/newline formatted)
else:
  existing block copy logic
```

**New method:** `getSelectedTableCells(): TableCell[][] | null` on `TextEditor`.

### Paste Flow

In `handlePaste`, after deserializing `WAFFLEDOCS_MIME`:

```
if payload has tableCells:
  if cursor is inside a table cell:
    1. Resolve current cell address (rowIndex, colIndex) via blockParentMap
    2. For each source cell [r][c], compute target address: (rowIndex + r, colIndex + c)
    3. Clamp to target table bounds — skip cells that exceed dimensions
    4. Deep-clone source cell blocks (regenerate IDs)
    5. Replace target cell's blocks via doc.updateCellBlocks()
    6. Move cursor to the last pasted cell
  else (cursor on normal block):
    Create a new table block from tableCells and insert at cursor position
else:
  existing block paste logic
```

**New method:** `pasteTableCells(cells: TableCell[][])` on `TextEditor`.

### Deep Clone Helper

Both copy and paste need to regenerate block IDs inside cells to avoid ID collisions:

```typescript
function cloneTableCells(cells: TableCell[][]): TableCell[][] {
  return cells.map(row =>
    row.map(cell => ({
      ...cell,
      style: { ...cell.style },
      blocks: cell.blocks.map(b => ({
        ...b,
        id: generateBlockId(),
        inlines: b.inlines.map(il => ({ text: il.text, style: { ...il.style } })),
        style: { ...b.style },
      })),
    }))
  );
}
```

### Changed Files

| File | Change |
|------|--------|
| `clipboard.ts` | `ClipboardPayload.tableCells`, serialize/deserialize extension |
| `text-editor.ts` | `handleCopy/Cut` cell-range branch, `getSelectedTableCells()`, `handlePaste` cell branch, `pasteTableCells()` |
| `clipboard.test.ts` | Serialize/deserialize round-trip tests for tableCells |

### Unchanged

- `selection.ts` — existing `tableCellRange` and `getSelectedText()` reused as-is
- `document.ts` — existing `updateCellBlocks()` reused
- `types.ts` — existing `TableCell`, `TableCellRange`, `CellAddress` reused

## Risks and Mitigation

| Risk | Mitigation |
|------|------------|
| Large cell ranges produce big clipboard payloads | JSON serialization is fast for typical table sizes (<1000 cells); defer optimization |
| Block ID collisions after paste | Always regenerate IDs via `generateBlockId()` during clone |
| Paste into merged cells may corrupt layout | Phase 1 skips colSpan/rowSpan — paste treats each cell independently |
| Cut from table leaves empty cells vs. removing rows | Cut replaces cell content with empty blocks (like spreadsheet behavior), does not remove structural rows/columns |

## Future Phases

- **Phase 2:** Whole-table block copy — extend `getSelectedBlocks()` to include table blocks with `tableData`, extend `insertBlocks()` to handle `type === 'table'`
- **Phase 3:** HTML table parsing — extend `parseHtmlToBlocks()` to handle `<table>/<tr>/<td>` elements, producing table blocks
