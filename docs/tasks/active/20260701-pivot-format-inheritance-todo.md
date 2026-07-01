# Pivot table format inheritance

## Problem

In the spreadsheet, when a pivot table ("표") is created from source data,
row/column **labels** and aggregated **value** cells render the raw source
value instead of the formatted value. The reported symptom: a date column
with a Locale Date format shows the raw ISO value (e.g. `2026-07-01`) in the
pivot labels rather than the formatted date.

## Root cause

The pivot pipeline drops the source cell's number format (`CellStyle.nf`,
`dp`, `cu`) at three points:

1. `packages/sheets/src/model/pivot/parse.ts` reads only `cell.v`; the
   cell style (including `nf`) is discarded — records become plain strings.
2. `packages/sheets/src/model/pivot/calculate.ts` builds labels / value
   cells from those raw strings, carrying no format.
3. `packages/sheets/src/model/pivot/materialize.ts` hardcodes the output
   cell style to `{ b: true }` (headers) / no style (values), so no `nf`
   ever reaches the rendered cell.

At render time `formatValue(value, style?.nf, ...)` (`format.ts`) sees an
undefined `nf` and returns the raw value (early return for falsy format).

Additionally, formats are usually stored as a **range-style layer**
(`ws.rangeStyles`) or column/row/sheet layer, NOT per-cell. The frontend
`buildSourceGrid` (`use-pivot-table.ts`) reads only `cell.s`, so even the
existing per-cell read would miss layered formats. The source grid must be
built from the **resolved effective style**.

## Reference behavior (Google Sheets / Excel)

Both inherit source data formatting into the pivot output:

- **Labels**: a date grouping field's labels keep the source column's date
  format.
- **Value cells**: SUM / AVERAGE / MIN / MAX inherit the source value
  column's number/currency format; COUNT / COUNTA stay plain (a count is a
  plain integer regardless of source format).

## Plan

- [x] Investigate root cause (parse → group → calculate → materialize → render)
- [x] Confirm where formats are stored (range-style layer, not per-cell)
- [x] Research GS/Excel reference behavior
- [x] **types.ts** — add `PivotCellFormat = Pick<CellStyle,'nf'|'dp'|'cu'>`;
      add optional `format?: PivotCellFormat` to `PivotCell`.
- [x] **parse.ts** — also return `columnFormats: (PivotCellFormat|undefined)[]`,
      one per source column, taken from the first data cell with a defined `nf`.
- [x] **calculate.ts** — attach `format` to:
      - row/col header labels when the axis has exactly one field
        (composite "A / B" joins get no format), using that field's column.
      - value + total cells using the value field's column format, unless the
        aggregation is COUNT/COUNTA.
- [x] **materialize.ts** — merge `pivotCell.format` into the output cell style.
- [x] **worksheet-grid.ts** — export `resolveWorksheetCellStyle(ws, ref)`
      mirroring `Sheet.resolveEffectiveStyle` (sheet → col → row → range →
      cell) for a raw worksheet document.
- [x] **use-pivot-table.ts** — `buildSourceGrid` attaches the resolved
      effective style to each source cell so layered formats reach the pivot.
- [x] Unit tests: pivot model carries `nf` to labels + value cells; COUNT
      stays plain; multi-field axis labels stay plain; `resolveWorksheetCellStyle`
      merges layers.
- [x] `pnpm verify:fast` green.

## Follow-up: charts have the same bug

Charts ("차트") render the same way: `getCellDisplayValue` in
`packages/frontend/src/app/spreadsheet/chart-utils.ts` read only `cell.v`, so
date/number category labels showed raw values. The Recharts category `XAxis`
has no `tickFormatter`, so the fix belongs in the extraction layer.

- [x] **chart-utils.ts** — split into `getCellRawValue` (raw, for numeric
      series values fed to `toNumeric`) and `getCellDisplayValue` (resolves
      effective style + `formatValue`, for category / pie / series labels).
- [x] **chart-utils.ts** — labels use the formatted getter; numeric series
      values use the raw getter (formatted `"$300.00"` would break parsing).
- [x] **sheets index** — export `formatValue` (the chart path needs it; it was
      previously internal-only).
- [x] Tests in `packages/frontend/tests/spreadsheet/chart-utils.test.ts`:
      labels inherit number/date format; currency-formatted value columns stay
      numeric (rows not dropped); pie labels formatted + values numeric.
- [x] `pnpm verify:fast` green.

## Non-goals

- Field-level format override UI (Excel "Value Field Settings" number format).
- Date grouping (Year/Month) — separate feature.

## Review

Implemented across the pivot model + the frontend source-grid builder:

- `PivotCellFormat` + `PivotCell.format` carry an inherited number format
  through the pure pivot pipeline.
- `parseSourceData` now returns `columnFormats` (first formatted data cell
  per source column).
- `calculatePivot` attaches the format to single-field row/column labels and
  to value/total cells (skipping COUNT/COUNTA), composite labels stay plain.
- `materialize` merges the format into the output cell style.
- `resolveWorksheetCellStyle` (new export) resolves the effective style
  (sheet → col → row → range → cell) from a raw worksheet document;
  `buildSourceGrid` uses it so formats stored as range/column layers — the
  common case — reach the pivot, not just per-cell `cell.s`.

Verification: 32 pivot/effective-style unit tests pass; `pnpm verify:fast`
green (frontend `tsc --noEmit` clean for the new import). Existing 20 pivot
tests unchanged.

Why the symptom appeared: commit timestamps (e.g.
`2026-07-01T09:30:00.000Z`) formatted to date-only via `nf: 'date'` showed
the full raw timestamp in pivot labels because the format was dropped. With
the format inherited, labels render date-only again. (Grouping distinct
timestamps into one date is a separate date-grouping feature — out of scope.)
