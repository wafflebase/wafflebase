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

- [ ] Model (`packages/sheets/src/model/worksheet/sheet.ts`)
  - [ ] Add a `RangeOpRefusal` reason type + `setOnRefusal` notification hook.
  - [ ] Emit `merge-source-split` / `merge-dest-partial` from `moveRangeTo`'s
        two pre-flight rejections and `merge-autofill` from `autofill`'s.
  - [ ] Call `consumeSpillBlocker()` in both `moveRangeTo` clearing loops and
        feed the unblocked anchors into the recalculation, as `removeData` does.
- [ ] View (`packages/sheets/src/view/worksheet.ts`, `spreadsheet.ts`)
  - [ ] Map each reason to user-facing text and push it through a host notice
        callback (`Spreadsheet.onNotice`), alongside the existing
        `onValidationError` channel.
- [ ] Frontend (`packages/frontend/src/app/spreadsheet/sheet-view.tsx`)
  - [ ] Register `onNotice` → `toast.error`.
- [ ] Tests (`packages/sheets/test/sheet/merge.test.ts`, `autofill.test.ts`)
  - [ ] Each refusal reports its reason.
  - [ ] A drag-move that clears a spill blocker lets the spill recover.

## Acceptance criteria (from #935)

1. A drag-move refused for a merge reason tells the user why instead of doing
   nothing visible.
2. The same treatment covers the source-split rejection and `autofill`.
3. `moveRangeTo`'s clearing loops honour the `consumeSpillBlocker()` contract.
