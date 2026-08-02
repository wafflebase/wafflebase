---
title: xlsx-style-import
target-version: 0.5.0
---

# XLSX Style Import — Preserving Formatting on Excel Import

> Companion to [file-import.md](file-import.md), which explicitly defers XLSX
> **style/formula fidelity** ("tracked separately"). This doc is that tracker:
> it closes the gap where importing a formatted `.xlsx` drops all visual
> formatting.

## Summary

`importXlsxWorkbook` now parses `xl/styles.xml` and resolves each cell's `s=`
(style index) attribute into a `CellStyle` (Phase 1, shipped): **fills, borders,
font weight/style (bold/italic/underline/strike), text color, horizontal/vertical
alignment, number format, column widths, row heights, and hidden rows/columns**
are imported. The per-cell patches are compacted into maximal rectangles before
they land on the worksheet (Phase 2 compaction, shipped), keeping the Yorkie
document small.

Still **not imported** and tracked as future work: conditional formatting, and
the model extension for per-cell **font family**, **font size**, and **cell
hyperlinks** — the handful of things the model genuinely can't express yet.
Originally none of this was imported (the importer read only cell values,
formulas, and merges); this doc tracked closing that gap.

## Motivation — the observed gap

Reference file: `Yorkie Task List.xlsx` (8 sheets). Unzipping it shows how much
formatting a real Google-Sheets-exported workbook carries. The table records the
gap that motivated this work and the current import status after Phase 1/2:

| Element in the file | Count / example | Imported now? |
|---|---|---|
| Fonts | 27 (Arial/Roboto, bold, underline, strike, 10/11pt) | ⚠️ weight/style/color ✅; **family/size ❌** (Phase 3) |
| Fills (background) | 9 (`D9EAD3` green, `C9DAF8` blue, `FFF2CC` yellow, `F4CCCC` red…) | ✅ |
| Borders | 13 (thin, per-side) | ✅ (per-side boolean) |
| Cell formats (`cellXfs`) | 117 (alignment, wrapText, vertical-center) | ⚠️ alignment ✅; wrapText ❌ |
| Number formats | percent (9/10), text (49), custom currency `"$"#,##0.00` (164) | ✅ |
| Column widths / hidden cols | `<cols>` customWidth ×9 + `hidden="1"` | ✅ |
| Conditional formatting | 5 `conditionalFormatting` blocks (dxf-based) | ❌ (not yet built) |
| Hyperlinks | 20 in sheet 1 alone | ❌ (model gap, Phase 3) |
| Comments | 12 legacy + threaded | ❌ |
| Drawings (images) | `drawing1`–`drawing8` | ❌ |
| Merges | — | ✅ |

### Root cause (addressed for styles in Phase 1)

Originally the importer discarded styles because `parseCell()` read only `<f>`
and `<v>` (the `s` attribute was ignored) and `importXlsxWorkbook()` never read
`xl/styles.xml`. Phase 1 fixed this:

- `parseWorksheet()` now reads each cell's `s` attribute and resolves it via
  `styleTable.resolveCellStyle` (`xlsx-importer.ts:351-354`).
- `importXlsxWorkbook()` parses `xl/styles.xml` once per workbook via
  `parseStyleTable` (`xlsx-importer.ts:420`, `xlsx-styles.ts`); the resolved
  styles flow onto `worksheet.rangeStyles`.
- The frontend wiring (`xlsx-actions.ts`) still copies `sheet.worksheet`
  verbatim, so the imported styles reach the store with no downstream change.

Still unread: `xl/drawings/*` and `xl/comments*.xml` (images/comments — see
Non-Goals) and the hyperlink relationships (Phase 3).

## Goals / Non-Goals

### Goals

Phase 1 (populate the existing model) and the Phase 2 range-style compaction
have shipped; conditional-format import and the font-family/size + hyperlink
model extension remain open.

- **Populate the styles the model already supports** from `xl/styles.xml` + the
  per-cell `s` index: fills, borders, bold/italic/underline/strike, text color,
  horizontal/vertical alignment, number format, column widths, row heights,
  hidden rows/columns.
- **Import conditional formatting** where it maps onto the existing
  `ConditionalFormatRule` / `ConditionalFormatStyle` model.
- **Extend the model minimally** for the two high-value things it can't express:
  per-cell **font family** and **font size**, and **cell hyperlinks**.
- Keep the importer **client-side** and dependency-light (continue using the
  built-in `DOMParser` + `JSZip` already in place — do not pull in a heavy
  workbook library).

### Non-Goals

- **Cell-internal rich-text runs** (different formatting within one cell) —
  `CellStyle` is per-cell; run-level styling is out of scope.
- **Images / drawings** import — needs binary extraction + the floating-image
  pipeline; deferred to a later phase (see Rollout Phase 4).
- **Comments import** — deferred; the `comments` model exists but the anchor /
  author mapping is a separate effort.
- **Round-trip export** of styles back to `.xlsx` — export is a separate
  roadmap item.
- Theme-color resolution beyond a basic indexed/theme→RGB fallback.

## Proposal Details

### 1. Style resolution pipeline

`xlsx-styles.ts` parses `xl/styles.xml` into an indexable style table
(`parseStyleTable`), then resolves each cell's `s` index to a `CellStyle`:

```text
styles.xml
  ├─ <numFmts>   numFmtId → formatCode        (custom, id ≥ 164)
  ├─ <fonts>     fontId   → { b,i,u,st,color,name,size }
  ├─ <fills>     fillId   → fgColor (solid patternFill)
  ├─ <borders>   borderId → { left,right,top,bottom present? }
  └─ <cellXfs>   s index  → { fontId, fillId, borderId, numFmtId, alignment }
```

`resolveCellStyle(s: number): CellStyle` composes the four sub-tables plus the
`<alignment>` on the `xf` into one `CellStyle`. Empty/default styles resolve to
`undefined` so we don't write noise patches.

### 2. Mapping table — XLSX → `CellStyle`

| XLSX | `CellStyle` field | Notes |
|---|---|---|
| `<font><b/>` `<i/>` `<u/>` `<strike/>` | `b` / `i` / `u` / `st` | boolean |
| `<font><color rgb>` / `theme` | `tc` | `#RRGGBB`; strip leading `FF` alpha; theme→RGB fallback |
| solid `<fill><fgColor rgb>` | `bg` | ignore `patternType="none"`/`lightGray` |
| `<border>` side present | `bt`/`br`/`bb`/`bl` | boolean per side (style/color detail dropped) |
| `<alignment horizontal>` | `al` | `left`/`center`/`right`; `general`→omit |
| `<alignment vertical>` | `va` | `top`/`center`→`middle`/`bottom` |
| numFmtId 9,10 | `nf: 'percent'` | `dp` from `0.00` decimals |
| numFmtId 164 `"$"#,##0.00` | `nf: 'currency'`, `cu` | infer currency from symbol; `dp` from format |
| numFmtId 14–22, custom date codes | `nf: 'date'` | date/time format codes |
| numFmtId 1–4, `#,##0` | `nf: 'number'`, `dp` | |
| numFmtId 49 (`@`) | `nf: 'plain'` | text |
| `<font><name>` / `<sz>` | **model gap** → §4 | font family / size |

**Number-format mapping** is the fiddliest: parse `formatCode` heuristically
(contains `%`→percent, currency symbol→currency, date tokens `y/m/d/h/s`→date,
else number) and count decimal places from the mantissa. A small lookup covers
the built-in ids (0–49); custom ids (≥164) go through the heuristic.

### 3. Cell-level vs range-level storage

XLSX styles are per-cell, but the model favors **range-scoped** patches
(`rangeStyles: RangeStylePatch[]`) plus `colStyles` / `rowStyles`. The shipped
importer collects one 1×1 patch per styled cell, then runs
`coalesceRangeStylePatchesMaximal` (`range-styles.ts`) to tile identical
adjacent cell styles into **maximal rectangles** before writing
`worksheet.rangeStyles`. Excel stamps a style on every cell of a formatted
table's used range, so this compaction is what keeps the Yorkie doc small.
Lifting whole-column/row uniform styles into `colStyles` / `rowStyles` is a
further optimization not yet applied.

Column widths → `colWidths` (convert Excel character-width units to px), row
heights → `rowHeights` (points→px), `hidden="1"` → `hiddenColumns` /
`hiddenRows`.

### 4. Model extension — font family, size, hyperlinks

`CellStyle` today has **no font-family and no font-size field**, and `Cell` has
**no hyperlink field**. These are the only "true" model gaps for this file.

```ts
// CellStyle additions
ff?: string;   // font family (e.g. "Arial", "Roboto")
fs?: number;   // font size in pt

// Cell addition
lk?: string;   // hyperlink target URL
```

Adding fields to `CellStyle` touches the style merge/compaction, the renderer
(Canvas `font` string already composes size/family — wire `ff`/`fs` in), the
toolbar, and Yorkie schema. Because of that blast radius, font family/size ship
as their **own phase** (Phase 3), decoupled from the fill/border/number-format
win in Phase 1. Hyperlinks (`lk`) render as clickable text and are similarly
self-contained.

### 5. Conditional formatting

Map `<conditionalFormatting sqref><cfRule>` onto `ConditionalFormatRule`:

- `sqref` → `ranges: Range[]`.
- `cfRule type` → `op`: `notContainsBlanks`→`isNotEmpty`,
  `containsBlanks`→`isEmpty`, `containsText`→`textContains`,
  `greaterThan`→`greaterThan`, `between`→`between`. Unsupported types
  (`colorScale`, `dataBar`, `iconSet`, formula-based) are **skipped** (logged).
- `dxfId` → resolve the `<dxfs>` differential style into
  `ConditionalFormatStyle` (only `b/i/u/tc/bg` are representable — the file's
  dxfs only set fill/font color, so they map cleanly).

### 6. Importer shape changes

`parseWorksheet` takes a `styleTable` parameter (parsed once per workbook) and,
per cell, resolves `s` → `CellStyle` and records it. The
`ImportedXlsxSheet.worksheet` carries `rangeStyles`/`colWidths`/`rowHeights`/
`hiddenRows`/`hiddenColumns`, and the frontend wiring needs **no change** — it
already copies the whole worksheet. Reading the hyperlink relationship
(`<hyperlinks>` + sheet `.rels`) is deferred to Phase 3 alongside the `Cell.lk`
model addition.

## Current Limitations

1. Border style/width/color collapse to a boolean per side (model has no border
   weight/color).
2. Theme/indexed colors use a static fallback palette — exotic theme overrides
   may resolve approximately.
3. Rich-text runs, images, and comments are not imported (later phases).
4. Conditional formats are not imported yet (planned; once built, formats
   beyond the mapped operator set will be skipped rather than approximated).
5. Per-cell font family/size and hyperlinks are not imported (the model lacks
   `CellStyle.ff`/`fs` and `Cell.lk`; Phase 3).

## Rollout

- **Phase 1 — core visual styles (biggest win). ✅ Shipped.** Parses
  `xl/styles.xml`; maps fills, borders, bold/italic/underline/strike, text
  color, alignment, number format; column widths / row heights / hidden. Stored
  as `rangeStyles`. No model change. (`xlsx-styles.ts`, `xlsx-importer.ts`.)
- **Phase 2 — compaction + conditional formatting. ◐ Partly shipped.** Range-
  style compaction via `coalesceRangeStylePatchesMaximal` ships in Phase 1
  already; whole-column/row lifting and conditional-format import are **not yet
  built**.
- **Phase 3 — model extension.** Add `CellStyle.ff`/`fs` (font family/size) and
  `Cell.lk` (hyperlink); wire renderer + toolbar + Yorkie schema. Not started.
- **Phase 4 — images & comments** (optional, largest surface). Not started.

## Risks and Mitigation

| Risk | Mitigation |
|---|---|
| One `rangeStyles` patch per cell bloats the Yorkie doc | Phase 1 tiles per-cell patches into maximal rectangles via `coalesceRangeStylePatchesMaximal`; col/row-uniform lifting and a hard patch-count cap with unstyled fallback remain future work. |
| Number-format heuristic misreads custom codes | Built-in id lookup first; heuristic only for custom ids; default to `plain` on ambiguity (never corrupt the value). |
| `CellStyle` field additions ripple across renderer/schema | Isolated in Phase 3; Phases 1–2 use only existing fields. |
| Theme-color resolution incomplete | Static indexed+theme fallback palette; document as approximate. |
| Large workbooks slow the client-side parse | Styles parsed once per workbook (not per cell) and resolved styles memoized per `s` index; reuse existing `DOMParser` path. |

## References

- Importer: `packages/sheets/src/import/xlsx-importer.ts`
- Style parser: `packages/sheets/src/import/xlsx-styles.ts` (`parseStyleTable`,
  `resolveCellStyle`, `mapNumberFormat`, `normalizeColor`)
- Frontend wiring: `packages/frontend/src/app/spreadsheet/xlsx-actions.ts`
- Model: `packages/sheets/src/model/workbook/worksheet-document.ts`,
  `packages/sheets/src/model/core/types.ts` (`CellStyle`, `NumberFormat`,
  `ConditionalFormatRule`), `packages/sheets/src/model/worksheet/range-styles.ts`
- [file-import.md](file-import.md) — parent import doc (defers this)
- [sheet-style.md](sheet-style.md) — style layers, merge & compaction semantics
- [data-validation.md](data-validation.md) — conditional-format / range-rule model
- ECMA-376 SpreadsheetML styles: `xl/styles.xml` (`fonts`/`fills`/`borders`/`cellXfs`/`dxfs`)
