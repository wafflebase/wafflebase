# Border outline extension on row/column insert

**Status:** done
**Scope:** `packages/sheets/src/model/worksheet/sheet.ts`,
`packages/sheets/test/sheet/formatting.test.ts`

## Goal

Match Google Sheets behavior: when a row/column is inserted inside a
range that already carries an outer border, the borders that run
continuously across the insertion seam (left/right for row inserts,
top/bottom for column inserts) extend into the new row/column so the
outline stays visually unbroken.

## Rule

For a row insert at `index` with `count` rows:

- For each column `c` where the cell at `(index-1, c)` and the cell at
  `(index+count, c)` (after shift) both have `bl: true`, set
  `bl: true` on every inserted cell `(i, c)` for `i ∈ [index, index+count-1]`.
- Same with `br: true`.

Symmetric for column insert at `index`:

- For each row `r` where `(r, index-1)` and `(r, index+count)` share
  `bt: true`, set `bt: true` on every inserted `(r, j)` for
  `j ∈ [index, index+count-1]`. Same with `bb`.

Borders are inherited only when **both adjacent cells** share the same
truthy value — partial / asymmetric borders do not extend.

## Implementation plan

1. Add a private helper `extendBordersAcrossInsertion` on `Sheet` that
   runs after `store.shiftCells` succeeds (only on inserts, count > 0).
2. Identify candidate columns/rows: scan cells in the two seam
   bands (above + below) that already carry the relevant border flags.
3. For each candidate where both bands agree, apply `setStyle` on the
   inserted cells inside the same store batch.
4. Use `getStyle` (effective style) so that column/row/sheet-level
   borders are honored, not just per-cell.

## Verification

- The two failing tests in `formatting.test.ts` should pass.
- Existing border tests must keep passing (no regression on the
  preset-application path).
- `pnpm verify:fast`.

## Result

- Added `extendBordersAcrossInsertion` to `Sheet`, called inside the
  existing post-shift batch in `shiftCells`.
- Three tests added to `formatting.test.ts` (row insert, column
  insert, insert-outside-range).
- `pnpm verify:fast` passed: 1207 sheets + 622 docs + 107 backend + 60
  other tests, exit 0.
- `docs/design/sheets/sheet-style.md` updated with a paragraph on the
  per-cell border seam-extension rule.
