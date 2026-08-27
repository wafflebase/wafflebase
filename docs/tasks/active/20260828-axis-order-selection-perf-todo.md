# Bound axis-ID coverage so far-out selections stay fast

## Problem

At row 1,000,000, navigation is instant but `Shift+Arrow` freezes the editor
for a long time (minutes, in the worst case).

Root cause — `Sheet.syncSelectionToPresence()`
(`packages/sheets/src/model/worksheet/sheet.ts`) passes the selection's
**maximum visual row/column index** to `Store.ensureAxisOrder()`. The Yorkie
store (`packages/frontend/src/app/spreadsheet/yorkie-store.ts`) then pushes one
CRDT array element per row until `rowOrder.length >= minRows` — so a single
`Shift+Down` at row 1,000,000 materializes ~1M axis IDs in one `doc.update`,
regardless of how sparse the sheet is.

Navigation is fast because `move()` clears `ranges` first, and only ranges drive
axis extension (`129f6c122`, #180 — the same freeze was fixed for `activeCell`
but left open for ranges). `selectRow()` / `selectColumn()` on a far-out header
hit the same path.

Measured (local Yorkie `Document`, no server):

| rowOrder size | first materialization | `getRowOrder()` copy | per-keystroke `new Set(rowOrder)` |
| ------------- | --------------------- | -------------------- | --------------------------------- |
| 10,000        | 110 ms                | 3 ms                 | 2 ms                              |
| 100,000       | 5,218 ms              | 12 ms                | 16 ms                             |

Cost is superlinear (10× size → ~47× time), so 1M is far worse than 50×.

Only the Yorkie store is affected — `MemStore`/`ReadOnlyStore` implement
`ensureAxisOrder` as a no-op.

## Approach

Axis IDs exist so a selection survives a peer's row/column insert or delete.
That only matters where the sheet has content; out in empty space the shipped
design already degrades to the legacy `activeCell` Sref presence field
(`docs/design/sheets/axis-id-selection.md`, "Migration / Backward
Compatibility"). So: **bound the coverage, and degrade beyond it** rather than
materialize a dense array to the grid boundary.

- Cap the coverage `syncSelectionToPresence()` will request.
- Beyond the cap: publish no anchors (`updateSelection(null, [], ref)`), which
  the Yorkie store already turns into `selection: undefined` + the legacy Sref,
  and clear the local anchors so `resolveAnchorsToRefs()` leaves the visual
  selection alone instead of snapping it back to a stale anchor.
- Early-out in `ensureAxisOrder()` when coverage already suffices, so a
  keystroke that needs nothing new costs no `doc.update` and no `Set` rebuild.

## Tasks

- [x] Failing test: `resizeRange` at row 1,000,000 requests no huge coverage
- [x] Failing test: `selectRow(1_000_000)` requests no huge coverage
- [x] Failing test: beyond-cap selection publishes `null` anchor + no ranges
      (never a `null`-endpoint anchor, which peers read as "entire column")
- [x] Failing test: within-cap selection still publishes anchors (no regression)
- [x] Failing test: beyond-cap selection is not cleared by `resolveAnchorsToRefs()`
- [x] Implement the cap in `syncSelectionToPresence()`
- [x] Early-out in `YorkieStore.ensureAxisOrder()`
- [x] Update `docs/design/sheets/axis-id-selection.md` (risk row + coverage rule)
- [x] `pnpm verify:fast`
- [ ] Manual smoke in `pnpm dev`: Shift+Arrow at row 1,000,000 is instant

## Review

### What changed

- `packages/sheets/src/model/worksheet/sheet.ts` — new exported
  `MaxAxisCoverage` (10,000). `syncSelectionToPresence()` returns early past
  the cap, publishing `updateSelection(null, [], activeCellRef)` and clearing
  the local anchors. Within the cap, `activeCellAnchor` is now assigned
  unconditionally instead of only when non-null.
- `packages/frontend/src/app/spreadsheet/yorkie-store.ts` — `ensureAxisOrder`
  returns before `doc.update` when both axes already cover the request.
  (`length` on a Yorkie array is O(1): measured 0.4 µs at 100k entries.)
- `packages/sheets/test/sheet/sheet.test.ts` — 4 tests, plus a
  `MaterializingStore` that mirrors the Yorkie store, since `MemStore` no-ops
  `ensureAxisOrder` and hides all anchor behavior.
- `packages/frontend/tests/app/spreadsheet/yorkie-axis-order.test.ts` — 3 tests
  over the real `YorkieStore` against a local unattached Yorkie document (no
  server needed).

### Measurements

Local `yorkie.Document`, pushing N ids into one `doc.update`:

| N | materialize | `getRowOrder()` copy | `new Set(rowOrder)` per keystroke |
| --------- | ----------- | -------------------- | --------------------------------- |
| 10,000 | 110 ms | 3 ms | 2 ms |
| 100,000 | 5,218 ms | 12 ms | 16 ms |
| 1,000,000 | **433,598 ms** | 97 ms | 318 ms |

After the fix, the 1M case issues no such call at all: the sheets tests assert
requested coverage stays ≤ `MaxAxisCoverage`.

### Also fixed

`activeCellAnchor` used to keep its previous value when the active cell sat
beyond coverage, so `resolveAnchorsToRefs()` on the next remote sync resolved
a stale anchor and pulled the cursor back (visible after Cmd+Down into empty
space). The anchor is now cleared with the selection it no longer describes.

### Review round (self-review before push)

The reviewer caught a real regression in the first implementation: the cap was
compared against the *requested* coordinate, so a selection spanning more than
10,000 rows of already-materialized data (a 50,000-row import — cell writes
grow the axis via `ensureWorksheetGrid`) lost its anchors even though no
extension was needed. Fixed: `ensureAxisOrder` is now asked for nothing when
the request exceeds the cap, and the degrade decision is made against the
coverage that actually exists (`maxRow > rowOrder.length`). Test added.

Also applied: an explicit no-anchor sentinel in `resolveAnchorsToRefs()` that
still repairs ranges when only the active cell is unanchored; removal of 10
now-dead `if (cellAnchor) this.activeCellAnchor = cellAnchor;` sites (each of
which also copied both axis arrays); vacuous-pass guards on two tests; a
column-only case for the store early-out; and the doc corrections below.

### Known limitations

- A selection that would extend coverage more than 10,000 past the data is not
  anchored, so peers see the cursor (legacy Sref) but not the range highlight,
  and that selection does not shift under a peer's row insert/delete.
  Deliberate — see the design doc's Coverage Bound section.
- **The axis is not globally bounded.** Writing a cell, inserting a row, or
  opening the comment composer at row 1,000,000 all still materialize ~1M IDs;
  the first is inherent to the ID-keyed cell model. Enumerated in the design
  doc under "What this does not bound".
- `YorkieStore.getRowOrder()` copies the whole axis array per call. This change
  removes 10 such copies from the hot path, but on a sheet whose data really
  does reach 100k rows the remaining calls still cost ~12 ms each. Caching it
  needs invalidation on remote sync and is left out.
- Manual browser smoke not run: no Postgres/Yorkie stack was up in this
  worktree, and port 8080 is answered by another checkout's stack, so a
  browser session would have exercised different code. When run, it should
  also type a value at row 1,000,000 — that path is still slow by design.
