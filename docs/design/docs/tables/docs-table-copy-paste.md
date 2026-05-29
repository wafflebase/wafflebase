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

- colSpan/rowSpan from external HTML (Phase 1 already defers this)
- Markdown cell formatting (bold `**text**`, etc.) — cells are plain text

### New Functions in `clipboard.ts`

#### `parseHtmlTableElement(tableEl: Element): Block | null` (private)

Converts a single `<table>` DOM element into a table `Block`. Used by
`parseHtmlToBlocks` when it encounters a `<table>` tag inline, and by
`parseHtmlTableToTableCells` for pure-table clipboard content.

Uses scoped `:scope >` selectors to avoid matching `<tr>` from nested tables.

#### `parseHtmlTableToTableCells(html: string): TableCell[][] | null`

For pure-table HTML (no surrounding paragraphs). Returns `TableCell[][]` for
use with `pasteTableCells()` (enables cell-by-cell paste into existing tables).

#### `parseMarkdownTableToTableCells(text: string): TableCell[][] | null`

For pure markdown tables (no surrounding text). Same cell-by-cell paste path.

#### `parseMarkdownWithTables(text: string): Block[] | null`

For mixed markdown content (text + tables). Detects markdown table regions
within the text and returns `Block[]` where table regions become table blocks
and text regions become paragraph blocks. Pads first/last with empty paragraphs
if they are table blocks (required by `insertBlocks` merge semantics).

#### `parseHtmlToBlocks` — enhanced with `<table>` handling

The existing `parseHtmlToBlocks` now handles `<table>` tags inline via
`parseHtmlTableElement()`. This is the primary path for pasting rendered
markdown from sources like Claude chat, which provide both `text/html` and
`text/plain` on the clipboard.

Also skips whitespace-only text nodes between block-level siblings
(e.g. `\n` between `<li>` tags) to avoid spurious empty paragraphs.

### `handlePaste` Flow

```
1. Image file         → existing handler
2. WAFFLEDOCS_MIME    → existing handler
3. text/html (no shift):
   a. parseHtmlTableToTableCells(html)
      → pure table: pasteTableCells() (cell-by-cell into existing table)
   b. parseHtmlToBlocks(html)
      → mixed content: tables become table blocks inline, text becomes paragraphs
4. text/plain (no shift):
   a. parseMarkdownTableToTableCells(text)
      → pure table: pasteTableCells()
   b. parseMarkdownWithTables(text)
      → mixed: tables + paragraphs via insertBlocks()
   c. insertPlainText(text)
      → fallback plain text
```

Shift+paste bypasses all table parsers (HTML and markdown) and forces plain text.

### Changed Files

| File | Change |
|------|--------|
| `clipboard.ts` | `parseHtmlTableElement()`, `parseHtmlTableToTableCells()`, `parseMarkdownTableToTableCells()`, `parseMarkdownWithTables()`, `collectInlines()`, `parentHasBlockChild()`, `<table>` handling in `parseHtmlToBlocks` |
| `text-editor.ts` | `handlePaste` flow with table parsers, single-table-block handling in `insertBlocks` |
| `clipboard.test.ts` | Tests for all parsers including mixed HTML/markdown, whitespace, nested tables |

### Risks and Mitigation

| Risk | Mitigation |
|------|------------|
| Nested tables in HTML | Scoped `:scope >` selectors prevent inner table rows leaking into outer table |
| Mixed HTML (table + paragraphs) | `parseHtmlToBlocks` handles `<table>` inline; `parseHtmlTableToTableCells` returns null for mixed content |
| Malformed markdown tables (ragged columns) | Pad short rows with empty cells to match the widest row |
| Google Sheets pastes `<table>` with heavy inline styles | `resolveInlineCSS()` already handles common CSS properties |
| Plain text that looks like a markdown table but isn't | Require separator line (`---`) as a mandatory signal |
| Table block as first/last in insertBlocks | Auto-pad with empty paragraphs to prevent merge corruption |

## Future Phases

- **Phase 2:** Whole-table block copy — extend `getSelectedBlocks()` to include table blocks with `tableData`, extend `insertBlocks()` to handle `type === 'table'`
