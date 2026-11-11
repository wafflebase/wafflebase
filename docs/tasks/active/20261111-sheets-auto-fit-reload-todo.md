# Sheets: keep fitted row heights across a remote reload (#1123)

Design doc: [sheet.md — Row height is fit-to-data unless pinned](../../design/sheets/sheet.md#row-height-is-fit-to-data-unless-pinned)

On a sheet with rows fitted to multi-line content, every remote change made
the local selection, peer cursors and fill handle below those rows flash at
the wrong position for one or two frames. Measured on wafflebase.io with two
clients: 8 of 8 remote edits painted the selection 117px too high (three
fitted rows × 39px) for 16–20ms.

Since #1116 a fitted height lives only in the view's `DimensionIndex`.
`runRemoteSync` → `reloadDimensions()` → `Sheet.loadDimensions()` cleared the
index and refilled it from `rowHeights`, which drops every fitted height. The
presence update that comes with the edit then draws the overlay against those
default heights before `renderSheet()` fits the rows again (and that pass
skips its own paint when a height changed).

## Tasks

- [x] `Sheet.loadDimensions(fittedRows?)` re-applies fitted heights to rows
      with no stored entry; reads both stores before clearing either index
- [x] `Worksheet.reloadDimensions()` passes `autoSizedRows` (minus hidden
      rows) with their current heights
- [x] Tests: `Sheet.loadDimensions` with fitted rows, and
      `Worksheet.reloadDimensions` against a real `Sheet` + `MemStore`
- [x] Update the fit-to-data section of `docs/design/sheets/sheet.md`
- [x] `pnpm verify:fast`
- [x] Manual check with two clients in `pnpm dev`
