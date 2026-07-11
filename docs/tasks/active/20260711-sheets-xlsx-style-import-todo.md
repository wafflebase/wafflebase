# XLSX Style Import — Phase 1 (core visual styles)

Design: [xlsx-style-import.md](../../design/sheets/xlsx-style-import.md)

## Problem

`importXlsxWorkbook` reads only cell values, formulas, and merges. It never
parses `xl/styles.xml` or the per-cell `s` index, so importing a formatted
`.xlsx` drops all fills, borders, fonts, alignment, number formats, column
widths, and hidden rows/cols. Observed with `Yorkie Task List.xlsx`.

## Scope — Phase 1 (no model change)

Populate the styles the model already supports:

- [x] Parse `xl/styles.xml`: `numFmts`, `fonts`, `fills`, `borders`, `cellXfs`.
- [x] `resolveCellStyle(s)` → `CellStyle` (bold/italic/underline/strike, text
      color `tc`, background `bg`, borders `bt/br/bb/bl`, alignment `al/va`,
      number format `nf`/`cu`/`dp`).
- [x] Per-cell `s` → collect `rangeStyles` patches (1×1), then coalesce.
- [x] `<cols>` → `colWidths` (Excel char-width → px) + `hiddenColumns`.
- [x] Row `ht`/`hidden` → `rowHeights` (points → px) + `hiddenRows`.
- [x] Date number formats: convert Excel serial → `YYYY-MM-DD[ HH:MM:SS]`.
- [x] Wire into `parseWorksheet` / `importXlsxWorkbook` (frontend needs no change).

## Out of scope (later phases)

- Conditional formatting import (Phase 2).
- Font family/size + hyperlink model extension (Phase 3).
- Images / comments (Phase 4).

## Verification

- [x] Unit tests: synthetic workbook with styles → assert `rangeStyles`,
      `colWidths`, `rowHeights`, `hiddenColumns/Rows` (17 tests).
- [x] Real-file smoke: `Yorkie Task List.xlsx` — 8 sheets import with fills,
      borders, number formats, font styles, alignment, col widths, hidden dims.
- [x] `pnpm verify:fast` green.

## Review

Shipped in three new modules under `packages/sheets/src/import/`:

- `xlsx-xml.ts` — shared XML traversal helpers (extracted from the importer;
  adds `directChildren`/`firstDirectChild`/`tryParseXml`).
- `xlsx-styles.ts` — `parseStyleTable()` → memoized `resolveCellStyle(s)`.
- `xlsx-serial-date.ts` — Excel serial → ISO date string.

`xlsx-importer.ts` now reads `styles.xml`, `<cols>`, and row `ht`/`hidden`, and
converts date serials on styled cells.

Code review (workflow, high) raised 3 correctness bugs, all fixed before commit:

1. Date-formatted cells kept the raw Excel serial (rendered as a number, not a
   date) — now converted to `YYYY-MM-DD[ HH:MM:SS]`.
2. Currency detection matched a `$` glyph anywhere in the raw format code
   (quoted labels) — now only bare / standalone-quoted / `[$…]` symbols count.
3. Font toggles ignored an explicit `val="0"` — now `val="0"/"false"/"none"`
   disables the toggle.

Plus cleanups: deduplicated XML helpers, `directChildren` to drop repeated
descendant re-filtering, and per-`s`-index memoization of `resolveCellStyle`.

A second review round fixed four more: non-USD locale currency blocks
(`[$€-407]`) mapped to USD; built-in currency ids 5–8 unmapped; pure
time-of-day serials rendering a spurious 1899 date; and a whole-sheet `<col>`
span writing 16384 width entries (now clamped near the data range). One finding
— that date-serial→ISO conversion "breaks" formula arithmetic — was declined:
Wafflebase stores dates as ISO strings natively (`TODAY()`/`DATE()`/`DAYS()`),
so converting matches native storage and actually fixes `YEAR`/`MONTH`/`DAYS`
that raw serials had broken.

Deferred (later phases, per design doc): conditional formatting, font
family/size + hyperlink model extension, images/comments.
