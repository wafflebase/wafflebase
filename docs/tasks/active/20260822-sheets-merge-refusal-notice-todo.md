# Sheets: explain silent merge refusals in drag-move / autofill (#935)

## Problem

`Sheet.moveRangeTo` rejects a drag-move that would split a merged block at the
source or only partially cover one at the destination, and `Sheet.autofill`
rejects a fill whose range touches any merged block. All three refusals return
without a word: the view clears its preview and the gesture looks like it did
nothing.

Separately, `moveRangeTo` clears cells in two loops (the source clear and the
merge-covered destination clear) without calling `consumeSpillBlocker()`, so a
cleared blocker never re-queues the spill anchor it was blocking — the spill
stays at `#REF!` until an unrelated edit touches it. Every other clearing path
in the model (`setData`, `removeData`) honours that contract.

## Decision

Surface a message rather than matching Google Sheets by unmerging and
proceeding. Silently destroying a merge the user built is a worse failure than
declining the gesture, and "unmerge and proceed" has no coherent analogue for
the source-split refusal or for autofill — a message applies uniformly to all
three, which is what the issue asks for.

## Plan

- [x] Model (`packages/sheets/src/model/worksheet/sheet.ts`)
  - [x] Add a `RangeOpRefusal` reason type + `setOnRefusal` notification hook.
  - [x] Emit `merge-source-split` / `merge-dest-partial` from `moveRangeTo`'s
        two pre-flight rejections and `merge-autofill` from `autofill`'s.
  - [x] Call `consumeSpillBlocker()` in both `moveRangeTo` clearing loops and
        feed the unblocked anchors into the recalculation, as `removeData` does.
- [x] View (`packages/sheets/src/view/worksheet.ts`, `spreadsheet.ts`)
  - [x] Map each reason to user-facing text and push it through a host notice
        callback (`Spreadsheet.onNotice`), alongside the existing
        `onValidationError` channel.
- [x] Frontend (`packages/frontend/src/app/spreadsheet/sheet-view.tsx`)
  - [x] Register `onNotice` → `toast.error`.
- [x] Tests (`packages/sheets/test/sheet/merge.test.ts`, `autofill.test.ts`)
  - [x] Each refusal reports its reason.
  - [x] A drag-move that clears a spill blocker lets the spill recover.

## Acceptance criteria (from #935)

1. A drag-move refused for a merge reason tells the user why instead of doing
   nothing visible.
2. The same treatment covers the source-split rejection and `autofill`.
3. `moveRangeTo`'s clearing loops honour the `consumeSpillBlocker()` contract.

## Review

Shipped as the notice path only: `RangeOpRefusal` + `Sheet.setOnRefusal`, the
three refusal sites, `refusalMessage` → `Spreadsheet.onNotice` → toast, and the
`consumeSpillBlocker()` contract in `moveRangeTo`'s two clearing loops.

Deferred, and deliberately **not** in this change: extending the spill-unblock
contract to the sibling clearing paths (cut-`paste`, `mergeSelection`,
`autofill`), ghost-travel semantics for move/paste, making a merged block block
a spill, and deriving `spillBlockers` from the store on load. That work is a
semantic change to spills rather than a notification, it needs its own
acceptance criteria (including `Worksheet.reloadDimensions`, the remote-change
path, and the `shiftCells`/`moveCells` key shifts), and a first attempt at it
regressed plain copy-paste of a spilled range to `#REF!`. Tracked on #935's
follow-up; see the discussion on #939.
