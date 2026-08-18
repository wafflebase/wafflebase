# Decimal round trip: make increase/decrease reversible (#845)

Increase decimal places followed by Decrease decimal places must leave a cell
exactly as it started — including leaving no `dp`/`nf` behind on a cell that had
none.

## The problem

Both handlers write an explicit `dp` and neither can express "unset"
(`packages/sheets/src/view/spreadsheet.ts:534` / `:549`). The starting `dp` is
*inferred* from the value string when nothing is stored
(`Sheet.getActiveDecimalState`, `packages/sheets/src/model/worksheet/sheet.ts:4157`),
and that inferred number is never written back — so "no explicit `dp`" and
"`dp` equal to the inferred one" are the same state on the way in and different
states on the way out.

On an empty cell the residue is `{ dp: 0, nf: 'number' }`, which pins the cell to
zero decimals: typing `12.5` afterwards renders `13`. `Math.max(0, dp - 1)`
clamps at `0` instead of returning to unset, so no sequence of the two buttons
gets the cell back to unstyled. `nf: 'number'` is equally one-way: set on the
way in, never removed.

Same residue family as #749 (`italic: false`) and #793 (`backgroundColor: ''`),
but unlike those it changes what the user sees.

## The change

**One rule, applied in both directions**: compute the target decimal count, and
if the target is what the cell would render at with *no* explicit `dp`, restore
inheritance instead of writing an equivalent explicit style.

1. **`Sheet.getActiveDecimalState`** also returns `valueDp` (the precision the
   raw value already shows: `2` for `12.34`, `0` for `12` or an empty cell) and
   `explicitDp` (whether any style layer sets `dp`). Today the inferred value is
   returned as `dp` and the caller cannot tell it apart from a stored one.

2. **`Sheet.unsetRangeStyleValues(style)`** — new: removes style keys from the
   layers the current selection *owns*, restoring inheritance.
   - owned = `sheetStyle` for an `all` selection, `colStyles` for a `column`
     selection, `rowStyles` for a `row` selection, any `rangeStyles` patch whose
     range is contained in the selection, and `cell.s` of cells inside it.
   - a key is removed only where it holds the value the caller names, so an
     unset can never flatten formatting it does not own.
   - returns `false` **without writing anything** when a layer outside the
     selection still sets one of the keys, or when a layer inside it disagrees
     about the value — the stored model has no "explicitly none" token, so unset
     is genuinely unrepresentable there and the caller must fall back to an
     explicit value. Cells are scanned before the first write.

3. **`Sheet.changeDecimals(delta)`** holds the rule (the model, not the view, so
   it is testable against `MemStore`); `Spreadsheet.increaseDecimals` /
   `decreaseDecimals` become render-and-notify wrappers:
   - `target = dp + delta`, clamped at `0`; nothing stored and no room left →
     no-op, so an untouched cell gains no zero-decimal format.
   - `target === valueDp` and `explicitDp` → try to unset (`{dp, nf}` when
     `nf === 'number'`, since `nf: number` with no `dp` renders 2 decimals and
     would change what is on screen; otherwise `{dp}`).
   - otherwise the existing explicit write.

Walking the reported case: empty cell → Increase writes `{dp: 1, nf: 'number'}`
→ Decrease targets `0`, which equals `valueDp`, so both keys are removed and the
cell is unstyled again. The `12.5` row of the issue's table ends the same way.
The reverse order works too: Decrease → `{dp: 0, nf: 'number'}` → Increase
targets `1 === valueDp` → unstyled.

## Tasks

- [x] `getActiveDecimalState` returns `valueDp` + `explicitDp`
- [x] `Sheet.unsetRangeStyleValues(style)` with the ownership + conflict rules
- [x] `changeDecimals` in `Sheet`, both view handlers routed through it
- [x] Unit tests: empty / integer / `12.5` round trips, N×increase + N×decrease,
      decrease-then-increase, a user `nf: 'number'` cell keeps its format when
      the target is not `valueDp`, unset falls back to an explicit write when a
      column style sets `dp`, and a currency/percent cell inside the selection
      refuses the unset instead of being stripped
- [x] `docs/design/sheets/sheet-style.md`: unset semantics + the decimal rule

## Known deviations

- `nf` cannot be attributed: a `nf: 'number'` cell whose `dp` a user steps all
  the way down to the value's own precision loses the number format along with
  the `dp`, because nothing stored says who wrote it. Google Sheets keeps a
  format there. Deviating this way is what makes the reported bug fixable at all;
  the value-scoped unset keeps it from ever reaching *another* cell's format, but
  it does take grouping separators with it (`1,234.5` → `1234.5`), which for a
  real round trip is the correct restoration.
- Decrease is a no-op when the active cell has no stored `dp` and no room to step
  down, which also leaves alone a selection whose other cells still have
  decimals. Writing `dp: 0` there is the residue the fix exists to remove. With a
  stored `dp` of `0` it does write `dp: 0` (so the rest of the selection follows)
  but never unsets: a clamped step reverses nothing, so taking the format with it
  would be destructive rather than a round trip.
- The unset also requires every numeric value in the selection to already render
  at the target precision, since restoring inheritance shows each cell at its
  *own* precision. A mixed-precision selection therefore takes the explicit
  write and follows the step, at the cost of not returning to unstyled.
- Emptying a column/row/sheet layer stores `{}`, since the `Store` interface has
  no delete for those layers, so `getStyle` can return `{}` where it returned
  `undefined`. Every consumer reads keys optionally, so it resolves the same.
