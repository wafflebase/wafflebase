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

- Round 1 (correctness and tests, self): no blocking findings.
  - Considered: a peer's row insert or delete above a fitted row. The
    carried heights are keyed by the old index for the frames before the
    next fit, so a fitted height can sit one row off until
    `applyAutoRowHeights` measures again. Before this change both rows were
    at the default in that window, so this is not a regression. Left as a
    known limitation.
  - Considered: hidden rows. They are zero-height in `rowDim`, so they are
    excluded from the carried map and come back through the hidden-row pass
    as before. Covered by a test.
  - Stopped after one round: the change is two small hunks with tests that
    fail without it.

## Verification

- `pnpm verify:fast` green.
- `pnpm dev` with two clients on a sheet with three fitted rows: 8 remote
  edits, the local selection below them was drawn 18 times, all at the same
  `y` (on wafflebase.io before the fix: 8 of 8 edits drew it 117px too
  high).
