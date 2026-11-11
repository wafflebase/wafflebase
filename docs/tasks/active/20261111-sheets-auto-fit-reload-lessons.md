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

- Round 2 (`@claude review`, 3 blocking, one duplicate pair, one marked
  unverified by the panel). Accepted:
  - `runHistoryStep` dereferenced `this.sheet!` after awaiting the replay;
    a teardown mid-replay, or a toolbar undo after `cleanup()` (the
    `Spreadsheet` keeps its own `sheet`), would throw. It and
    `reloadDimensions` now re-check the sheet after every await, the way
    `applyAutoRowHeights` already did.
  - `resyncHiddenAxes` rebuilt hidden-row backups from `rowDim`, so a render
    that re-hid a row before it ran would leave a 0 backup and the row stuck
    at 0px once shown. A zero backup is now replaced by the previous one.
    In practice the awaits involved are microtasks and no render fits
    between them, but nothing guarantees that.
  - Took from the suggestions: `runHistoryStep` also refreshes the freeze
    state, so the toolbar and keyboard undo agree; tests for a hidden column
    across a reload, a hidden fitted row across an undo, and the
    no-axis-ID case asserted on `takeFittedRows` directly (the old version
    passed with the guard removed).
- Not taken from round 2: reusing the reloaded `rowDim` instead of reading
  `pinned` again (`rowDim` also holds hidden zeros and cannot tell a stored
  height from a default one); `anchor-conversion` helpers for the ID map
  (they resolve single cells, not a whole axis); avoiding the full
  `getRowOrder()` copy per reload (`renderSheet` already copies it every
  frame); the no-op on `MemStore` / `ReadonlyStore`, which have no axis IDs
  and no remote changes, so the bug cannot occur there.

- Round 3 (`@claude review`, 1 blocking). Accepted: the only test over
  `Spreadsheet.undo` / `redo` stubbed `runHistoryStep` as a pass-through, so
  reverting the delegation would keep the suite green. It is a spy now, and
  a reverted `undo` fails it. Also took: the "sheet lost mid-replay" test now
  asserts what the guard leaves behind instead of only that nothing threw.
- Not taken from round 3: a carried height on a row a peer just merged
  (`applyAutoRowHeights` already keeps a fitted row's height when it becomes
  a merge anchor, by design and with a test); overlapping reload and replay
  (`runRemoteSync` already serializes reloads, and the worst case is the
  default heights a reload always produced); a `readOnly` check inside
  `runHistoryStep` (both callers gate it); moving the API to
  `Worksheet.undo()` / `redo()` (the step stays the model's).

- Round 4 (`@claude review`, 3 blocking). All accepted:
  - The zero-backup guard fell back with `??`, which keeps a previous
    backup that is itself 0. Any non-positive backup now falls back to the
    default, and `takeFittedRows` never carries a 0.
  - The keyboard Mod+Z / Mod+Shift+Z path had no test of its delegation;
    `worksheet-keymap.test.ts` now asserts it.
  - A remote reload and an undo could interleave; the host serializes
    remote reloads only among themselves. `reloadDimensions` and
    `runHistoryStep` now run through one queue. The first test written for
    this passed without the queue too — `MemStore` resolves in microtasks, so
    nothing overlapped — and was rewritten with real delays so the undo
    snapshots while the reload is mid-flight; it fails without the queue.

## Verification

- `pnpm verify:fast` green.
- `pnpm dev` with two clients: 8 remote edits with four fitted rows above the
  local selection, selection drawn 16 times at one `y`; a peer inserting a
  row above moved every fitted height down one row with it, and the row they
  left went back to the default (on wafflebase.io before the fix: 8 of 8
  edits drew the selection 117px too high).
