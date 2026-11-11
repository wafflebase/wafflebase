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

- Round 5 (`@claude review`, 1 blocking, low confidence). Accepted: a
  local insert, delete or move shifts `rowDim` but not the view's
  index-keyed `autoSizedRows` / `autoSizedRowIds`, so a reload or undo landing
  before the next fit could file one row's height under another row's ID.
  `DimensionIndex` now counts its renumberings; a snapshot taken after one,
  and before the next fit, carries nothing. The first version of the test
  passed without the guard (one fitted row pairs with a default height
  either way) and was rewritten with two adjacent fitted rows.

- Round 6 (`@claude review`, 2 blocking). Both accepted: `restoreFittedRows`
  re-registered rows a peer's insert had pushed below the last measured row
  without widening `autoSizedMaxRow`, so a second reload before the next fit
  dropped them — `autoSizedMaxRow` now grows to cover every restored row; and
  the freeze-state refresh `runHistoryStep` took over from the keyboard
  handler was stubbed out in every test — it is a spy now. Both new tests
  fail with their fix removed.

- Round 7 (`@claude review`, 1 blocking). Accepted: the renumbering guard
  added in round 5 was reset by the next fit even though that fit leaves
  skipped rows (hidden, merge anchors) and rows past the measured range
  untouched, so their index→ID pairs stayed stale behind a guard that said
  they were fresh. A fit that follows a renumbering now drops the axis ID of
  every row it does not re-key; those rows go back to being measured, as
  before the change. The fix only ever carries less, never a different
  height.
- Round 8 (`@claude review`, 4 blocking). Three were about a line this
  file carried — a note on how many more review rounds would run. That was
  process talk addressed at reviewers and does not belong in the
  repository; it was removed. The fourth is real: the render path's
  `applyAutoRowHeights` writes the same state as the reload queue and was
  not in it, so a fit that landed between a reload's awaits could leave
  `autoSizedRows` out of step with `rowDim`. The queue now counts the
  reloads in flight, and a fit that finds one running after its awaits
  writes nothing and asks for another frame — the path it already takes
  after resizing a row. It cannot simply join the queue: a render must not
  wait behind a reload.

- Local review before pushing round 9 (a separate agent, same lenses as the
  panel): no blocking findings. Took its suggestions: `reloadDimensions` now
  re-checks the sheet after every load, as the design doc says, not only
  after the dimension reload; the fit's hold-off also compares a reload
  generation, so a reload that starts and finishes inside the fit's awaits
  is caught; the hold-off tests start with nothing in flight and let the
  reload begin during the fit's await; and a guard that no test could
  distinguish (the empty-candidates branch) was removed, with the reason in
  a comment. A second pass over that delta found the generation was taken
  after `renderSheet` had already awaited `fetchGrid`, the grid the fit
  measures; it is now taken before the fetch and passed in.

- Round 9 (`@claude review`, 3 blocking). Two accepted:
  - The generation was bumped only when a reload started, so a reload
    already running when `renderSheet` took it, and finishing during the
    fit's awaits, went unseen. The fit then wrote heights measured against
    the pre-reload `skip`, which could un-hide a row a peer had just hidden
    and leave it visible for good. The generation is now bumped on the way
    out too.
  - `renderSheet` passing the pre-fetch generation had no test; a new suite
    drives `renderSheet` and fails if the capture moves after the fetch.
- Not taken from round 9 (low confidence in the panel too): undo and redo
  share the reload queue, so a store read that never settles would stall
  undo behind it. The stores in this repository settle locally; a timeout
  or a per-path queue is recorded as a known limitation in the PR.
- Local review of that fix (same agent): no blocking findings. Took two
  suggestions: the render also stamps `rowDim.getRenumberings()` before the
  fetch, so a local insert, delete or move inside the fit's window makes it
  stand down like a reload does; and the test for the exit bump runs a real
  reload through the queue and releases it inside the fit's await — the
  first version simulated the bump in a stub and passed with the bump
  removed.

- Round 10 (`@claude review`, 3 blocking). All three were in the
  concurrency machinery itself: the fit's hold-off could keep a sheet from
  painting while a reload was slow; the reload read the pinned heights
  before `loadDimensions`, so a local resize between the two was reverted;
  and undo queued behind remote reloads could stall with them.

## Redesign: fitted heights as a layer of `DimensionIndex`

- Every round from 4 on fixed an interleaving between three writers of the
  same state (remote reload, undo, the render-path fit), and each fix — a
  queue, a hold-off, a generation counter, a renumbering counter — was the
  next round's finding. The writers conflicted only because fitted heights
  shared one map with stored heights and hidden zeros, so a reload had to
  snapshot and restore them. Splitting that map into stored, fitted and
  hidden layers removes the conflict instead of serializing it: a reload
  replaces only the stored layer, hiding no longer overwrites a size, and
  the fitted layer carries axis IDs so `realignFitted` can follow rows by ID
  at any time, synchronously and idempotently. The queue, the hold-off, both
  counters, `runHistoryStep`, the snapshot and restore, and the hidden-size
  backups are all gone; undo needs nothing of its own.
- `DimensionIndex` is what every pixel position comes from, so the change
  kept its lookup algorithm as it was and only merges the layers when the
  cache is rebuilt. A seeded randomized test drives the real index and a
  deliberately naive reference (one array per layer, `splice` for shifts and
  moves, linear sums and scans) through the same operations and compares
  every size, offset and lookup. Mutating the index — keys not shifted in
  one layer, the delete zone off by one, hidden layer left out of the cache,
  realign skipped or dropping ID-less sizes, a stored write not dropping the
  fitted size — fails between 36 and 155 of the 150 seeds and unit cases.
  One mutant survives by construction: keeping default-sized entries in the
  cache adds deltas of zero.
- Caught while writing it: the stored layer keeps no entry for the default,
  so a row pinned to exactly the default would have shown its fitted height
  through the pin. Any stored write now drops the fitted size at its index.
  `loadDimensions` therefore realigns before writing the stored sizes, or a
  peer's pin would drop the fitted height of the row that used to sit there.
- Also caught: reading the store before clearing the stored layer (to avoid
  an empty layer during the await) loses a local resize that lands between
  the read and the write. Kept `main`'s order — clear, then read — and a
  test with a store whose read answers after the local edit.

- Local review of the redesign (separate agent): no blocking findings.
  Took two should-fix items and four nits:
  - The merges and the remaining columns are read one await after the grid,
    so a renumbering in between put them on other rows' indices for a pass.
    The fit now takes the row order again as it reads them and maps both into
    the grid's numbering by axis ID.
  - Nothing pinned `renderSheet` taking the row order before the fetch, or
    rebuilding the freeze state when rows are hidden or shown; a stubbed
    `renderSheet` suite now does, and fails if either moves.
  - The painter gets the order the grid was read against instead of a fresh
    copy, which also saves one copy of the axis per frame.
  - Dropped a reload test that only asserted an unconditional call.
  - Recorded as limitations in the PR: with no axis IDs, an undone insert
    leaves fitted heights at the old indices until the next fit; and a pin a
    peer clears shows the default until the next render fits the row.

- Round 11 (`@claude review`, 3 blocking). All accepted:
  - Performance: the fit took one or two extra copies of the whole row order
    per frame (`getRowOrder()` is ~12 ms at 100k rows, and a prior task had
    removed such copies from this path). A pass now takes one copy, shared
    with the painter, and takes another only when `rowDim`'s renumbering
    count or the axis length says rows were renumbered. A test fails if the
    fit copies again when nothing changed.
  - Data-source and lakehouse views reload a read-only store with no axis
    IDs to show a new result set, and fitted heights of the old rows stayed
    on the new ones. `loadDimensions` drops the fitted layer when the store
    has no axis IDs.
  - `axisTranslator` dropped every index past axis-ID coverage, which would
    lose merges and heights there. Indices past coverage now map to
    themselves. Writing a cell gives its row an ID, so such rows have no
    content; the change is defensive.
  - Also taken: `initialize` resets the hidden layers along with the fitted
    one; `applyAutoRowHeights` and `fetchRowRemainder` lost the test-only
    defaults that would let a caller drop the order; an unreachable
    `findIndex` branch went; a drag-move fixture hides rows through
    `setHidden`; the design doc lost the backup sentence and says where the
    fitted layer departs from `axis-id-selection.md`. Not taken: moving
    `axisTranslator` beside the anchor helpers, and an upper bound on
    fitted heights (both predate this change in kind).
- CodeRabbit on the same head: one minor, outside the diff — an async store
  could let an older dimension read land after a newer one. Pre-existing on
  `main`, and both stores read synchronously; not changed.

## Verification

- `pnpm verify:fast` green.
- `pnpm dev` with two clients: 8 remote edits with four fitted rows above the
  local selection, selection drawn 16 times at one `y`; a peer inserting a
  row above moved every fitted height down one row with it, and the row they
  left went back to the default (on wafflebase.io before the fix: 8 of 8
  edits drew the selection 117px too high).
