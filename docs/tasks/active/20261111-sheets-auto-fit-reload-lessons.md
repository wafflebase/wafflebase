# Sheets: keep fitted row heights across a remote reload — Lessons

## Diagnosis

- A per-frame recorder on the receiving client was what made the bug
  visible: wrapping `CanvasRenderingContext2D.strokeRect` on the overlay
  canvas to log the local selection's `y`, and sampling it on every
  `requestAnimationFrame`. The wrong position lasts one or two frames, which
  no screen recording or screenshot catches.
- A background tab runs no `requestAnimationFrame`, so the observing client
  has to be the visible tab and the writer the background one. The first
  attempt observed from a background tab and saw nothing.
- The jump only shows below rows whose height came from auto-fit. A sheet
  with single-line values, or presence-only movement, looked clean and
  could pass for "not reproducible".

## Self review

- Round 1 (correctness and tests, self): no blocking findings on the first
  version. That was wrong on the row-renumbering point; see below.

## Review panel

- Round 1 (`@claude review`, 4 blocking, one pair of duplicates). All
  accepted:
  - `autoSizedRows` is keyed by index and never renumbered, so after a peer's
    insert, delete or move the first version carried a fitted height onto
    whatever row now sat at the old index. Self review had called this a
    one-frame glitch; it is not, because `applyAutoRowHeights` leaves rows
    below the fetched range alone, so a wrong height there would persist.
    Fixed by recording each fitted row's axis ID at fit time and carrying the
    heights by ID; rows below the last fitted range, and rows with no ID, are
    not carried, as before the change.
  - Undo and redo reload dimensions through `Sheet.replayHistory` and were
    still dropping fitted heights. Both the keyboard and the toolbar paths now
    go through `Worksheet.runHistoryStep`, which carries them the same way.
  - The hidden-row test stubbed out the very pass it relied on. The tests now
    run the real `syncHiddenRowsFromSheet`, which also showed a hidden fitted
    row's backup reset to the default; the snapshot now carries the backup.
- Took the design-fit suggestion: the carry lives in the view next to the
  hidden-row backup it resembles, and `Sheet.loadDimensions` is unchanged.
- Side effect: `runHistoryStep` re-applies hidden rows and columns after the
  replay, the way `reloadDimensions` always did. An undo used to leave
  hidden rows at the size the replay reloaded until something else re-synced
  them (read from the code — `syncHiddenRowsFromSheet` only re-zeroes rows
  newly hidden — not reproduced by hand).

## Verification

- `pnpm verify:fast` green.
- `pnpm dev` with two clients: 8 remote edits with four fitted rows above the
  local selection, selection drawn 16 times at one `y`; a peer inserting a
  row above moved every fitted height down one row with it, and the row they
  left went back to the default (on wafflebase.io before the fix: 8 of 8
  edits drew the selection 117px too high).
