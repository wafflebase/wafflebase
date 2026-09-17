# Sheets undo/redo selection restore

## Problem

In Sheets, `Cmd+Z` / `Cmd+Shift+Z` do not move the selection to what was
undone. Google Sheets restores the selection to the affected range and
scrolls it into view — showing *what* changed is half of what undo is for.

The engine already implements the restore
(`packages/sheets/src/model/worksheet/sheet.ts`, `undo()` / `redo()`): when
the store hands back an `affectedRange`, it sets `activeCell` and `ranges`.
The defect is upstream, in how that range is computed.

`YorkieStore.computeAffectedRange()`
(`packages/frontend/src/app/spreadsheet/yorkie-store.ts`) claims to find
cells "added, removed, or modified", but only takes the **set difference of
cell keys** plus a `merges` comparison. A cell present before and after with
a different value is never detected, so the range comes back `undefined` and
the selection stays put.

Measured behaviour:

| Action, then undo | Detected | Selection moves |
| --- | --- | --- |
| Type into an empty cell | key removed | yes |
| Delete a cell's content | key added | yes |
| **Overwrite an existing value** | no | **no** |
| **Cell / range style change** | no | **no** |
| **Column width, row height** | no | **no** |
| Merge / unmerge | merges diff | yes |
| Insert / delete rows or columns | keys shift | yes, but the range is the bounding box of everything that shifted |
| A change in **another tab** | no | no, and no tab switch |

## Google Sheets spec

1. Undo/redo select the range the undone change touched and scroll it into
   view.
2. A single-cell edit puts the cursor on that cell; a range edit (paste,
   style, sort, fill) selects the whole range.
3. A change in another sheet **switches to that sheet** before selecting.
4. Undoing a row/column insert or delete selects those rows/columns as a
   header selection, not as a cell range.
5. The undo stack is per-user. (Yorkie's `doc.history` already matches.)

## Approach

Stop inferring the range by diffing document state, and read it from the
undo's **own operations**. `doc.history.undo()` publishes a `local-change`
event synchronously, carrying `OperationInfo[]` whose paths are precise:

```text
$.sheets.<tabId>.cells          key "r3|c2"   cell written or removed
$.sheets.<tabId>.cells.r3|c2    key "v"       cell field written
$.sheets.<tabId>.rangeStyles                  style patch added/removed
$.sheets.<tabId>.rowOrder                     row inserted/deleted
$.sheets.<tabId>.colWidths      key "4"       column resized
$.sheets.<tabId>              key "frozenRows"
```

That gives the tab, the exact cells (by stable axis id), and the kind of
change — cross-tab and style/dimension edits included — for the cost of the
ops actually replayed. It is also cheaper than today's code, which walks
every cell of the current tab on each undo.

Axis ops (`rowOrder` / `colOrder`) carry no index, so the store snapshots
the axis id arrays before the undo and diffs them after to find the affected
index span. Axis arrays are one entry per used row/column, so this is
strictly less work than the current per-cell scan.

`rangeStyles` ops likewise carry no value, so the same before/after diff
recovers the patch whose range should be selected.

## Design

`Store.undo()` / `redo()` return `{ success, selection? }` where

```ts
type UndoSelection = {
  tabId: string;
  selectionType: SelectionType;   // 'cell' | 'row' | 'column'
  range?: Range;                  // absent when the step has no coordinates
  otherTab: boolean;              // tabId is not the tab this store opened
};
```

`range` is optional on purpose: a freeze pane or a filter change names the
tab it happened in and nothing more, and the selection is then left alone
rather than guessed at.

`otherTab` is resolved inside the store, which is the only layer that knows
its own tab id. `Sheet` applies the selection when it is false, and fires
`onUndoTabJump` when it is true; the view forwards that to `SheetView`,
which reuses the existing `peerJumpTarget` pattern (`setActiveTabId` plus a
`requestId`-keyed target applied once the new tab's engine mounts).

A step reaches several tabs more often than it looks —
`shiftCrossTabDataRanges` rewrites every other tab's chart and pivot source
ranges inside the same change as the row insert that moved them — so each
touched tab is resolved independently and ranked *structural > coordinates >
incidental*. The highest rank wins; the open tab is preferred only within a
rank. Deferring to the open tab unconditionally would land a cross-tab row
insert on whichever tab merely held the chart, where there is nothing to
show.

## Tasks

- [x] `UndoSelection` / `UndoResult` types on the `Store` interface, replacing `affectedRange`
- [x] `resolveUndoSelection()` — pure op-to-selection resolver, unit tested without Yorkie
- [x] `YorkieStore.undo()` / `redo()` capture ops + axis/rangeStyles snapshots; delete `computeAffectedRange`
- [x] `MemStore` / `ReadOnlyStore` signature updates
- [x] `Sheet.undo()` / `redo()` apply `selectionType` (row/column header selection, not always `'cell'`)
- [x] `Sheet.setOnUndoTabJump()`, mirroring the existing `setOnRefusal` callback
- [x] `Spreadsheet.undo()` / `redo()` scroll the restored selection into view (the keyboard path in `worksheet.ts` already does; the public API path did not)
- [x] Cross-tab: `Spreadsheet.onUndoTabJump()` → `SheetView` prop → `DocumentLayout` tab switch + jump target
- [x] Unit tests: resolver (cell / row / column / style / cross-tab / no-op), `Sheet` selection application
- [x] `pnpm verify:fast`, then `pnpm verify:self`
- [x] Manual smoke in `pnpm dev`
- [x] Document the restored-selection rule in `docs/design/sheets/sheet.md`

## Non-Goals

- Changing what one undo step *contains*. Batching is already settled by
  `beginBatch` / `endBatch` (`docs/design/sheets/batch-transactions.md`).
- Freeze-pane and hidden-row undo selection. Those changes have no cell
  coordinates; the selection is left alone rather than guessed.
- `MemStore` undo support. It returns `{ success: false }` today and this
  task does not change that.

## Review

### What landed

| Layer | File |
| --- | --- |
| Types | `packages/sheets/src/store/store.ts` — `UndoSelection`, `UndoResult` |
| Resolver | `packages/sheets/src/model/workbook/undo-selection.ts` (new, pure) |
| Store | `packages/frontend/src/app/spreadsheet/yorkie-store.ts` — `replayHistory()` / `snapshotTabs()`; `computeAffectedRange` deleted |
| Engine | `packages/sheets/src/model/worksheet/sheet.ts` — `replayHistory()`, `applyUndoSelection()`, `setOnUndoTabJump()` |
| View | `packages/sheets/src/view/spreadsheet.ts` — scroll on undo/redo, `onUndoTabJump()`, `focusUndoSelection()`; `worksheet.ts` — `revealActiveCell()` |
| App | `sheet-view.tsx` `undoJumpTarget` / `onUndoJump` props, `document-detail.tsx` `handleUndoJump` |

37 new tests across three layers: 17 on the pure resolver, 8 on the engine's
selection application, 12 on `YorkieStore` against a real (detached) Yorkie
document — the last being where the reported defect actually lived.

### Two corrections found during implementation

1. **Axis operations are not proof of a structural edit.** Writing a cell
   into untouched space grows `rowOrder` / `colOrder` in the same change, so
   the first cut selected the extended rows instead of the cell — breaking
   the commonest case while fixing the rare one. `diffAxisSpan` now answers
   `undefined` for a tail-only diff.
2. **A cell may have no post-replay coordinates.** Undoing that same write
   removes the ids it added, so the cell being shown is off the axis.
   Resolution falls back to the pre-replay axes, which is sound precisely
   because the truncation is at the tail.

### Manual smoke (`pnpm dev`, real Yorkie)

| Case | Result |
| --- | --- |
| Overwrite `C4`, move to `A1`, undo | Cursor jumps to `C4`, value reverts |
| Redo from a distant cell | Returns to `C4` |
| Undo a row-6 insert | Row 6 selected as a **header** selection (`6:6`) |
| Undo an edit made in Sheet2 while Sheet1 is open | Switches to Sheet2, selects `D8` |

### Review findings addressed (PR #1072, CodeRabbit)

All three were confirmed against the code and fixed; each has a test that
fails without the fix.

1. **`applyUndoSelection` broke the merge invariant.** Every other path that
   sets `ranges` calls `expandRangeToMergedBoundaries`, and every path that
   sets `activeCell` goes through `normalizeRefToAnchor` — a replayed step
   reports raw coordinates and can land mid-block. Both halves now applied.
   (CodeRabbit named the range half; the active-cell half is the same bug.)
2. **`diffRangeStyles` only looked one way.** Styling a range usually
   *replaces* a compacted patch rather than adding one, and the "additions
   first, removals only if there were none" shape then reported the new
   region while dropping whatever the old one covered beyond it. Now a
   two-way multiset difference, unioned.
3. **A pending `undoJumpTarget` survived a revision restore.** `SheetView`
   remembers the handled request in a mount-local ref, and `historyResetToken`
   remounts it — so the stale selection could be applied a second time against
   a document that no longer exists. Cleared in `handleHistoryRestored`, next
   to the `doc.clearHistory()` that already invalidates it. The suggested
   acknowledgement round-trip was not needed: the restore is the only remount,
   and it is exactly where the target stops meaning anything.

`peerJumpTarget` and `commentJumpTarget` have the same mount-local-ref shape
and are left alone — pre-existing, and re-applying a bare cell reference after
a restore is benign.

### Second review round

4. **The open tab was preferred unconditionally.** `shiftCrossTabDataRanges`
   rewrites other tabs' chart and pivot source ranges inside the *same* change
   as the row insert that moved them, so a user sitting on the chart's tab and
   pressing undo stayed there — on a tab with no coordinates — and the row
   insert was undone invisibly on the other one. That is the original failure,
   reintroduced in a corner. Each touched tab is now resolved independently and
   ranked *structural > coordinates > incidental*, with the open tab preferred
   only within a rank.

   The same review also raised the cell-write version of this (an edit in TabB
   whose dependent formula writes touch TabA). That one is **not reachable**:
   `recalculateCrossSheetFormulas` opens its own `beginBatch`/`endBatch`, so it
   is a separate undo entry, it is driven asynchronously by the view's
   remote-sync cycle rather than inline with the edit, and it writes only
   through the current tab's store. No single undo unit contains a user's edit
   on one tab plus recalculated cells on another. The ranking fix is the right
   generalisation regardless, and needs no provenance tracking.
5. **Doc fixes**: the operation-path fence is tagged `text` (MD040), and
   `UndoSelection.range` is documented as optional, matching the source.

### Third review round (agent panel, 3 blocking)

6. **Whole-array `rangeStyles` writes were never matched.** `setRangeStyles`
   assigns (or deletes) the entire array on the worksheet, so its operation is
   `{path: '$.sheets.<tab>', key: 'rangeStyles'}` — not the array op
   `addRangeStyle`'s `push` produces. The resolver only matched the push, and
   the push is the *rare* path: every style merge, compaction, replace, clear
   and reset goes through `setRangeStyles`. So the headline "style change →
   selection moves" row was false for most style undos, and the unit tests
   passed because they only ever fed the array-op path shape. Matched now, and
   pinned by two tests against a **real store write** rather than a hand-built
   snapshot.
7. **The editable share view was not wired.** `readOnly` there is
   `role === 'viewer'`, so an editor following a share link can undo, and that
   host has a tab bar. `SharedDocumentLayout` now carries `undoJumpTarget` /
   `onUndoJump` like `DocumentLayout`, and the prop doc that claimed the view
   was read-only is corrected.
8. **`Spreadsheet.focusUndoSelection` had no test.** It is the landing half of
   a cross-tab undo; if its row/column/cell mapping were wrong the feature
   would ship broken. Covered at both levels in
   `packages/sheets/test/view/spreadsheet-undo-selection.test.ts`.

Taken with them, since they were right and cheap:

- Selection restore was implemented **twice** — `Sheet.applyUndoSelection`
  hand-rolled what `selectRow` / `selectStart` do, while the cross-tab path
  called those same methods. Collapsed onto one public `Sheet.applySelection`
  that both paths run, so a future rule added to `selectRow` cannot apply to
  only one of them. The hand-rolled merge normalisation disappears with it.
- A step that resized or restyled **both** axes yielded no range at all; it
  now falls back to the block they bound.
- `snapshotTabs` used raw `Object.keys` on the Yorkie record where the repo
  uses `safeWorksheetRecordKeys`.
- `handleUndoJump` switched tabs without the tab-exists/is-a-sheet check every
  other jump path in that file performs.
- `MemStore` / `ReadOnlyStore` now declare `UndoResult` rather than a
  structurally-compatible inline type.
- The design doc's `Store` snippet still advertised `undo(): Promise<boolean>`,
  and the known limits below lived only in this archived file — they are now in
  `docs/design/sheets/sheet.md`, which is the canonical record.

Declined, with reasoning: adding a `_readOnly` guard to `focusUndoSelection`.
It moves a selection, which a viewer may do, and `selectStart` / `selectEnd`
on the same class are ungated for that reason. Nothing there writes, and the
undo that produced the selection is gated already.

### Fourth round — the panel's remaining suggestions

The panel's second run never executed (`POOL_EXHAUSTED` on every lens), so
these are the round-1 suggestions and nits not already taken above.

Taken:

- **The React jump wiring was untested, and duplicated.** Wiring the share
  view had copied `handleUndoJump` into a second host. Both, plus
  `SheetView`'s effect guards, now go through
  `packages/frontend/src/app/spreadsheet/undo-jump.ts` —
  `isJumpableSheetTab` and `shouldApplyUndoJump`, each a decision that had
  been written inline twice, each now tested.
- Tests for the `merges` branch and its unparseable-key path, the
  `rowStyles` / `colStyles` branches, the weight tie-break between two
  equally-ranked tabs, and `revealActiveCell` on the `Spreadsheet.undo` /
  `redo` path.
- A test pinning that an **unrelated** style patch stays out of the reported
  range, which is what the "wholesale rewrite reports everything" concern
  turns on: `cloneRangeStylePatch` / `normalizeRangeStylePatch` are
  deterministic, so an untouched patch serialises identically and is matched
  by the multiset diff. Only patches that genuinely differ are reported, and
  their union is the honest answer for "what this step changed".

Declined, with reasoning:

- **Insert/delete at the end of an axis is misclassified as extent growth.**
  Not fixable from the data available: writing a cell into untouched space
  grows `rowOrder` at its tail, and so does inserting past the last row —
  the array diff is identical, and nothing else in the change distinguishes
  them (`applyWorksheetShift` writes only what is non-empty). The fallback is
  sound rather than wrong: the cell branch selects the cells the step
  touched, which are on the affected rows. Pinned by a test so the behaviour
  is deliberate, and recorded in `docs/design/sheets/sheet.md`.
- **A coordinate-less step in another tab still switches tabs.** It only
  reaches that branch when *no* tab in the replay had coordinates — a freeze
  pane, a filter, a hidden row. Those are visible changes on the tab that
  owns them, so switching is how the user sees the undo happened at all.
  Staying put is the behaviour this PR exists to remove.
- **A `_readOnly` guard on `focusUndoSelection`** — see the third round.

### Known limitations

- Inserting or deleting at the **end** of an axis reads as a tail truncation,
  so it selects the affected cells rather than the row or column header. Every
  interior insert/delete is exact. Now recorded in `docs/design/sheets/sheet.md`
  too.
- Freeze pane, filter state and hidden rows carry no coordinates; those
  undos leave the selection where it is (they do still switch tabs).
- `conditionalFormats` / `dataValidations` hold their ranges in the rule
  values, which array operations do not carry. They could be recovered by
  the same before/after diff `rangeStyles` uses; not done here.
- `MemStore` still has no undo, so the harness's interaction scenarios
  cannot exercise any of this.
