# Table Copy-Paste — Lessons

## Root Cause: tableData lost during block clone

`getSelectedBlocks()` cloned blocks without preserving `tableData`, causing
tables to silently disappear on paste. The fix: deep-clone `tableData` (rows,
cells, block IDs) during block extraction.

**Why:** The clone code was written for paragraph/heading/list blocks (which
only have `inlines`). Table blocks store their content in `tableData`, not
`inlines`, so the existing clone missed it entirely.

## Debugging approach

- Adding console.log to the copy/paste pipeline traced the data flow end-to-end
- Programmatic ClipboardEvent dispatch via Puppeteer confirmed `insertBlocks`
  worked but `requestRender()` was blocked by a debug log error
- Inspecting the serialized clipboard payload revealed `type: "table"` blocks
  with no `tableData` — pinpointing `getSelectedBlocks()` as the source

## Follow-ups

- Phase 2: whole-table block copy (extend `insertBlocks` for `type === 'table'`)
- Phase 3: HTML table parsing (`parseHtmlToBlocks` for `<table>/<tr>/<td>`)
