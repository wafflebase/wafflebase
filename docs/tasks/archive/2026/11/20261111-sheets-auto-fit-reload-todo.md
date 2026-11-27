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

- [x] Split `DimensionIndex` into stored, fitted and hidden layers; a reload
      (`clear` + `setSize`) replaces only the stored layer, and any stored
      write drops the fitted size at its index
- [x] Fitted sizes carry their row axis ID; `realignFitted(order)` follows
      rows by ID, run by `Sheet.loadDimensions` (reload, undo, redo) before
      the stored sizes go back in
- [x] `applyAutoRowHeights` writes to the fitted layer, through the row's
      axis ID to its current index (`axisTranslator`), with the order
      `renderSheet` took before fetching the grid
- [x] Hidden rows and columns through `setHidden`; no size backups
- [x] Tests: randomized comparison of `DimensionIndex` against a naive
      reference; reload against a real `Sheet` + `MemStore`, including a
      peer's insert, move, delete and pin; undo; the fit with rows
      renumbered mid-pass
- [x] Update `docs/design/sheets/sheet.md`
- [x] `pnpm verify:fast`
- [x] Manual check with two clients in `pnpm dev`

