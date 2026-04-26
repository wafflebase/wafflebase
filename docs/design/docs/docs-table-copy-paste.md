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

This document covers Phase 1 (cell-to-cell) and Phase 3 (external table paste).

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

**Files:** `clipboard.ts` — add new `serializeClipboard()` and `deserializeClipboard()` functions that handle the optional `tableCells` field (existing `serializeBlocks`/`deserializeBlocks` kept for backward compatibility).

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
    5. Replace target cell's blocks via doc.updateBlockDirect()
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

## Phase 3: External Table Paste

### Summary

Parse external table content from two sources — HTML `<table>` elements and
markdown table syntax — into `TableCell[][]`, then reuse the existing
`pasteTableCells()` method to insert them.

### Goals

- Paste HTML tables from Google Docs, Sheets, web browsers, etc.
- Paste markdown tables (`| col | col |` syntax) from text editors, GitHub, etc.
- Preserve inline formatting from HTML table cells (bold, italic, links, etc.)
- Reuse existing `pasteTableCells()` — no new insertion logic needed

### Non-Goals

- Parsing mixed content (table + paragraphs) as a table — only pure-table HTML triggers table paste
- colSpan/rowSpan from external HTML (Phase 1 already defers this)
- Markdown cell formatting (bold `**text**`, etc.) — cells are plain text

### New Functions in `clipboard.ts`

#### `parseHtmlTableToTableCells(html: string): TableCell[][] | null`

1. Parse HTML with `DOMParser`, find the first `<table>` element
2. If no `<table>` found or the HTML contains significant non-table content, return `null`
3. Walk `<tr>` rows, then `<td>`/`<th>` cells within each row
4. For each cell, reuse the existing inline-walk logic to produce `Inline[]`
   with formatting (bold, italic, color, links, etc.)
5. Wrap each cell's inlines in a single paragraph `Block` inside a `TableCell`
6. Return the 2D `TableCell[][]` array

#### `parseMarkdownTableToTableCells(text: string): TableCell[][] | null`

1. Split text into lines, trim each line
2. Validate markdown table structure:
   - At least 2 lines (header + separator)
   - Lines start and/or contain `|` delimiters
   - Second line matches separator pattern (`---`, `:---:`, etc.)
3. Skip the separator line, parse remaining lines by splitting on `|`
4. Each cell becomes a `TableCell` with a single paragraph block containing
   plain-text inline
5. Return the 2D `TableCell[][]` array, or `null` if not a valid markdown table

### `handlePaste` Flow Change

```
1. Image file         → existing handler
2. WAFFLEDOCS_MIME    → existing handler
3. text/html (no shift):
   a. parseHtmlTableToTableCells(html)
      → if non-null: saveSnapshot → deleteSelection → pasteTableCells() → return
   b. parseHtmlToBlocks(html)
      → existing block paste
4. text/plain:
   a. parseMarkdownTableToTableCells(text)
      → if non-null: saveSnapshot → deleteSelection → pasteTableCells() → return
   b. insertPlainText(text)
      → existing plain-text paste
```

### Changed Files

| File | Change |
|------|--------|
| `clipboard.ts` | Add `parseHtmlTableToTableCells()`, `parseMarkdownTableToTableCells()` |
| `text-editor.ts` | Update `handlePaste` to try table parsers before existing fallbacks |
| `clipboard.test.ts` | Tests for both parsers: basic tables, formatting, edge cases, rejection |

### Risks and Mitigation

| Risk | Mitigation |
|------|------------|
| HTML with mixed table + paragraph content | Return `null` from table parser — fall through to existing `parseHtmlToBlocks` |
| Malformed markdown tables (ragged columns) | Pad short rows with empty cells to match the widest row |
| Google Sheets pastes `<table>` with heavy inline styles | `resolveInlineCSS()` already handles common CSS properties |
| Plain text that looks like a markdown table but isn't | Require separator line (`---`) as a mandatory signal |

## Future Phases

- **Phase 2:** Whole-table block copy — extend `getSelectedBlocks()` to include table blocks with `tableData`, extend `insertBlocks()` to handle `type === 'table'`
