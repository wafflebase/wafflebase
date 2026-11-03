# Sheets: rows fit their content after any write (#1115)

## Problem

A cell value containing `\n` written through the v1 API / CLI
(`wafflebase sheets cells set <doc> A1 "first<newline>second"`) is stored
in full, but the row keeps its previous height, so only the first line is
visible. The row grows only after the user double-clicks the cell.

The cause is that auto-fit lives entirely in the local editor commit path:
`Worksheet.autoResizeRow()` runs only after `commitCellValue()` returns
true, and it *persists* the measured height into `rowHeights`. Nothing
recomputes a row height for a value that arrived from the API, an import,
a paste, or a remote collaborator.

## Approach

Make "fit to data" the rendering rule rather than a one-shot action, which
is how Google Sheets behaves:

- A row with **no** `rowHeights` entry is sized to its content on every
  render, in memory only — nothing is written to the CRDT.
- A row **with** a `rowHeights` entry is a manually sized row and is left
  alone. That entry is only ever written by an explicit gesture (drag the
  row border) or by the v1 dimensions API.

Because the pass runs in `renderSheet()` off the grid it already fetched,
it covers every write source — editor, API/CLI, import, paste, undo, and
remote collaborators — with one implementation.

## Tasks

- [x] `packages/sheets/src/view/auto-row-height.ts` — pure, testable
      `autoRowHeight(lines)` + `computeAutoRowHeights(grid, skipRows)`.
- [x] `Worksheet.applyAutoRowHeights()` called from `renderSheet()`;
      re-render once when a height changed.
- [x] Skip rows that carry a persisted height (manual) and rows anchoring a
      multi-row merge (the block, not the row, is the text box there).
- [x] Drop the now-redundant commit-path auto-resize: `autoResizeRow`,
      `autoResizeActiveRow`, `computeContentHeight`, `manuallyResizedRows`.
- [x] `Store.clearDimensionSize()` so double-clicking a row border means
      "return this row to fit-to-data" instead of pinning a height.
- [x] Unit tests for the pure module + a `clearDimensionSize` store test.
- [x] Note the behavior in `docs/design/sheets/sheet.md`.

## Non-goals

- Soft-wrapped text (only explicit `\n` counts, as before).
- Column auto-width on write.
- Persisting the fitted height back into the document.
