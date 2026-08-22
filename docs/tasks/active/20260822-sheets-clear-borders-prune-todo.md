# Sheets: Clear borders should remove the border keys (#878)

## Problem

**Cell borders → Clear borders** writes `bt/bl/br/bb: false` into every cell of
the selection instead of removing those keys. A cell that carried no style at
all before the borders were applied ends up carrying one:

```
after All borders   {"bt":true,"bl":true,"br":true,"bb":true}
after Clear borders {"bt":false,"bl":false,"br":false,"bb":false}   <- residue
```

`Bold` on the same cell round-trips to `null`, because it goes through
`setRangeStyle` → `addRangeStylePatch`, which runs
`pruneRedundantDefaultStyleKeys` (all four border keys already sit in that
function's `DefaultStyleValues` table). `setRangeBorders` instead writes each
cell through `setStyle`, whose documented contract is to preserve an explicit
`false` — correct for the primitive, wrong for a clear operation.

The same residue applies to every preset that writes `false` for an edge
(`outer`, `inner`, and the interior cells of `all`), and `setStyle` even
*creates* a style-only cell for a previously empty one when the patch is
all-defaults.

## Approach

Keep `setStyle`'s contract untouched. Route the border-preset path through a
new private `applyBorderPatch(anchor, range, patch)` in `Sheet` that merges the
patch into the cell and then drops the patch keys that sit at their default,
using the same `pruneRedundantDefaultStyleKeys` + `getStyleSources()` machinery
the range-style path uses. Only the keys the border patch touched are
considered, so unrelated cell style is left alone, and a `false` that is needed
to override a conflicting column/row/sheet/range-style layer is still kept
(that is exactly what `hasConflictingStyleSourceForKey` decides).

When every key prunes away and the cell has no other content, the cell is
deleted rather than stored as a style-only shell.

Rendering is unaffected: `gridcanvas` and `sheet-view` read borders as truthy
checks (`style.bt`, `isFalseOrUnset`), and the insert-time outline extension
compares `=== true`.

## Steps

- [x] `sheet.ts`: add `applyBorderPatch`, use it from `setRangeBorders`.
- [x] `test/sheet/formatting.test.ts`: assert the clear round trip returns the
      cell to `undefined`, and update the `all`/`outer` expectations that
      asserted the `false` residue.
- [x] Self review + draft PR.

## Acceptance criteria (from #878)

- `Clear borders` leaves the cell as it was before any border was applied —
  keys removed, not set to `false` — matching the `Bold` round trip.
