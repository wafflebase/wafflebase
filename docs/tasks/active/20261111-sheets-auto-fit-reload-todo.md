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
skips its own paint when a height changed). Undo and redo reload the same
way through `Sheet.replayHistory`.

## Tasks

- [x] Record each fitted row's axis ID (`autoSizedRowIds`) and the last
      fitted range (`autoSizedMaxRow`) in `applyAutoRowHeights`
- [x] `takeFittedRows` / `restoreFittedRows`: carry fitted heights across a
      reload by axis ID; a stored height wins; rows past the fitted range or
      without an ID are not carried
- [x] Use them in `reloadDimensions` and in a new `runHistoryStep` that the
      keyboard and toolbar undo/redo go through; both re-apply hidden axes
      from scratch afterwards (`resyncHiddenAxes`)
- [x] Tests: reload and undo against a real `Sheet` + `MemStore` with the real
      hidden-row pass, including a peer's insert and delete; ID recording in
      `applyAutoRowHeights`
- [x] Update the fit-to-data section of `docs/design/sheets/sheet.md`
- [x] `pnpm verify:fast`
- [x] Manual check with two clients in `pnpm dev`
