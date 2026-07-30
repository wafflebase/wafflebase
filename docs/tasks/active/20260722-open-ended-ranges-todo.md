# Whole-column / whole-row / open-ended range references

Issue: #280

## Goal

Support Excel / Google-Sheets range shapes that omit part of an endpoint:

- `=SUM(A:A)` — entire column A
- `=COUNT(1:1)` — entire row 1
- `=AVERAGE(B2:B)` — open-ended column range (B2 → bottom of column B)
- `=SUM(A:C)` — multi-column whole range
- `=SUM(2:5)` — multi-row whole range

Each behaves as if the range covered every populated cell in the named
columns / rows (unused cells contribute zero / nothing), matching
Excel / Google Sheets.

## Approach

The engine models a range as a concrete `[from, to]` pair of `Ref`s, so an
unbounded range has to be clamped to the sheet's actual data extent before
evaluation. Rather than thread bounds through the whole evaluator + every
`toSrefs` call site, we resolve unbounded refs to concrete bounded ranges up
front, using the sheet's used bounds.

1. **Grammar** (`antlr/Formula.g4`): factor `REF` into `COL`/`ROW` fragments and
   extend `REFRANGE` to accept `COL:COL`, `ROW:ROW`, `REF:COL`, `COL:REF`,
   `REF:ROW`, `ROW:REF` in addition to `REF:REF`. Regenerate with
   `pnpm sheets build:formula`.
2. **Bounds source**: `CellIndex.bounds()` → min/max populated `Range`; expose
   via `Store.getUsedBounds()` (MemStore / ReadOnlyStore / YorkieStore all
   delegate to their `CellIndex`) and `Sheet.getUsedBounds()`.
3. **coordinates.ts**: `isUnboundedRange(ref)` + `resolveRange(srng, bounds)`
   that fills omitted row/col from the bounds (`from` omitted → 1/1,
   `to` omitted → maxR/maxC), then normalizes via `toRange`.
4. **formula.ts**: `expandUnboundedRanges(formula, bounds)` — tokenize, rewrite
   every local unbounded `REFERENCE` token to its concrete `toSrng(range)`;
   fast-path returns the formula unchanged when none present.
5. **Wire-in**: calculator rewrites `cell.f` before `extractReferences` /
   `evaluateWithSpill`; `buildDependantsMap` (MemStore + YorkieStore) rewrites
   each formula before extracting deps so column/row edits still trigger
   recalculation.

Cross-sheet unbounded refs (`Sheet2!A:A`) are out of scope — the calculator only
knows the local sheet's bounds; they are left unexpanded (evaluate to `#ERROR!`).

## Checklist

- [ ] Grammar: COL/ROW fragments + extended REFRANGE
- [ ] Regenerate ANTLR parser (`pnpm sheets build:formula`)
- [ ] `CellIndex.bounds()`
- [ ] `Store.getUsedBounds()` + 3 impls + `Sheet.getUsedBounds()`
- [ ] `isUnboundedRange` + `resolveRange` in coordinates.ts
- [ ] `expandUnboundedRanges` in formula.ts
- [ ] Wire calculator + buildDependantsMap
- [ ] Tests: coordinates unit, formula expand, calculation (5 issue cases + reactivity)
- [ ] Update `docs/design/sheets/formula.md`
- [ ] Draft PR

## Acceptance (issue setup: A1=10 A2=20 A3=30 B1=100 B2=200)

| Formula          | Expected |
| ---------------- | -------- |
| `=SUM(A:A)`      | 60       |
| `=SUM(1:1)`      | 110      |
| `=AVERAGE(B2:B)` | 200      |
| `=COUNT(A:B)`    | 5        |
| `=SUM(1:3)`      | 360      |
