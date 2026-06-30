# Pivot table format inheritance — lessons

- Cell number/date formats in this codebase are usually stored as a
  **range-style layer** (`ws.rangeStyles`) or column/row/sheet layer, not on
  `cell.s`. A grid built from `getWorksheetCell` alone (per-cell style only)
  cannot see them — resolve the effective style (sheet → col → row → range →
  cell) when you need the format outside the live `Sheet` instance.
- `colStyles`/`rowStyles` on the worksheet document are keyed by **index**
  (`String(col)`), and `rangeStyles` ranges are in index space — so the
  effective-style merge can be reproduced on the raw document without axis-id
  mapping.
- `formatValue` returns the raw value for a falsy/`'plain'` format, so a
  missing `nf` silently shows the unformatted source value.

- Thread inherited data through the **pure pivot model** as plain data
  (`PivotCell.format`) and merge it only at `materialize`. This keeps the
  model testable with a `Grid` whose `cell.s` carries formats, independent of
  where the frontend actually stores them.
- Only inherit a label format when the axis has exactly one grouping field —
  composite "A / B" labels join multiple columns, so no single format applies.
- Counts (`COUNT`/`COUNTA`) must NOT inherit the source format; the result is
  a plain integer regardless of whether the source column was currency/date.
- After cross-package API changes, rebuild the **producer** dist before
  verifying consumers. A stale `packages/docs/dist` (from an earlier commit)
  surfaced as a `cli typecheck` error in an unrelated file — rebuilding docs
  cleared it. Confirm such failures are pre-existing before treating them as
  your regression. (See [[project_packages_consume_built_dist]].)
- `pnpm verify:fast` runs `frontend lint`/`test` but no `frontend typecheck`;
  type-check a frontend-only change explicitly with
  `npx tsc --noEmit -p packages/frontend/tsconfig.json`.

## Known limitations (from self code review)

- **First-formatted-cell-per-column wins.** `parseSourceData` picks each
  column's format from the first data cell that carries an `nf`. With the
  effective-style resolution this is uniform for the common whole-column /
  range-format case; a column with genuinely *mixed per-cell* formats collapses
  to the first one. Acceptable — matches how a single column format reads.
- **Numeric grouping labels render formatted.** Grouping rows by a currency /
  number column shows formatted group keys (e.g. `$300.00`) — intentional GS /
  Excel parity, not a bug. Text labels are unaffected (`formatValue` returns
  non-numeric values unchanged).
- **Merged source cells.** `resolveWorksheetCellStyle` does not normalize to the
  merge anchor, so a pivot source over a merged region may read per-cell style
  only from the anchor. Edge case; pivoting over merged source data is already
  unusual.
- **`resolveWorksheetCellStyle` takes an optional pre-fetched `cellStyle`** to
  skip a redundant `getWorksheetCell` (mirrors `Sheet.resolveEffectiveStyle`).
  The per-cell range-style scan over the configured source range is inherent
  (same pattern the renderer uses for the viewport).

## Charts: the same bug in a second derived view

- The original report said "표" (table) but the actual surface was **charts**.
  Every view that re-reads source cells and re-emits values (pivot, chart, and
  likely export) repeats the "read `cell.v`, drop the format" mistake. When one
  is reported, check the siblings — `resolveWorksheetCellStyle` + `formatValue`
  is the shared fix.
- In charts, the SAME extraction helper fed both **labels** and **numeric
  values**. Formatting must apply to labels only — a currency/number format on
  the value column would turn `"100"` into `"$100.00"`/`"1,234"` and break
  `toNumeric`, silently dropping data points. Split label vs value getters.
- `formatValue` was internal to the sheets package; the chart fix required
  exporting it from the package index (it's the canonical formatter the grid
  and pivot already use internally). Runtime symptom of a missing export is
  `formatValue is not a function` — the dist simply doesn't re-export it.
- Frontend vitest only runs `tests/**/*.test.ts` (see `vite.config.ts` →
  `test.include`); a `*.test.ts` placed under `src/` is NOT executed. Put
  frontend tests under `packages/frontend/tests/`.
