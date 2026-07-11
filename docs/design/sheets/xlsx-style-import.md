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

Today `importXlsxWorkbook` reads only **cell values, formulas, and merges**. It
never opens `xl/styles.xml` and never inspects the per-cell `s=` (style index)
attribute, so **every fill, border, font weight/color, alignment, number
format, column width, hidden row/column, and conditional format is discarded on
import.** A richly-formatted workbook lands as unstyled black-on-white text.

The good news: the `Worksheet` / `CellStyle` model can already represent the
majority of this. The fix is largely a **populate-the-existing-model** job in
the importer, plus a small **model extension** (font family/size, hyperlinks)
for the handful of things the model genuinely can't express yet.

## Motivation — the observed gap

Reference file: `Yorkie Task List.xlsx` (8 sheets). Unzipping it shows how much
formatting a real Google-Sheets-exported workbook carries, and how much is lost:

| Element in the file | Count / example | Currently imported? |
|---|---|---|
| Fonts | 27 (Arial/Roboto, bold, underline, strike, 10/11pt) | ❌ |
| Fills (background) | 9 (`D9EAD3` green, `C9DAF8` blue, `FFF2CC` yellow, `F4CCCC` red…) | ❌ |
| Borders | 13 (thin, per-side) | ❌ |
| Cell formats (`cellXfs`) | 117 (alignment, wrapText, vertical-center) | ❌ |
| Number formats | percent (9/10), text (49), custom currency `"$"#,##0.00` (164) | ❌ |
| Column widths / hidden cols | `<cols>` customWidth ×9 + `hidden="1"` | ❌ |
| Conditional formatting | 5 `conditionalFormatting` blocks (dxf-based) | ❌ |
| Hyperlinks | 20 in sheet 1 alone | ❌ (model gap) |
| Comments | 12 legacy + threaded | ❌ |
| Drawings (images) | `drawing1`–`drawing8` | ❌ |
| Merges | — | ✅ **the only style-adjacent thing imported** |

### Root cause

- `parseCell()` (`xlsx-importer.ts:187`) reads only `<f>` and `<v>`; the `s`
  attribute is ignored.
- `importXlsxWorkbook()` never reads `xl/styles.xml`,
  `xl/worksheets/_rels/*.rels`, `xl/drawings/*`, or `xl/comments*.xml`.
- The frontend wiring (`xlsx-actions.ts:31`) copies `sheet.worksheet` verbatim —
  no styling is added downstream either.

## Goals / Non-Goals

### Goals

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

Add a `xl/styles.xml` parser that produces an indexable style table, then
resolve each cell's `s` index to a `CellStyle`:

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
(`rangeStyles: RangeStylePatch[]`) plus `colStyles` / `rowStyles`. Two options:

- **Simple (Phase 1):** write one `rangeStyles` patch per styled cell (a 1×1
  range). Correct, but produces one patch per cell — heavy for large sheets.
- **Compacted (Phase 2):** run the existing range-style compaction (the same
  logic used elsewhere in `range-styles.ts`) to coalesce identical adjacent
  cell styles into rectangular patches, and lift whole-column/row uniform styles
  into `colStyles` / `rowStyles`. This is what keeps the Yorkie doc small.

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

`parseWorksheet` gains a `styleTable` parameter (parsed once per workbook) and,
per cell, resolves `s` → `CellStyle` and records it. `parseCell` additionally
reads the hyperlink relationship (`<hyperlinks>` + sheet `.rels`). The
`ImportedXlsxSheet.worksheet` then carries `rangeStyles`/`colWidths`/etc., and
the frontend wiring needs **no change** — it already copies the whole
worksheet.

## Current Limitations

1. Border style/width/color collapse to a boolean per side (model has no border
   weight/color).
2. Theme/indexed colors use a static fallback palette — exotic theme overrides
   may resolve approximately.
3. Rich-text runs, images, and comments are not imported (later phases).
4. Conditional formats beyond the mapped operator set are skipped, not
   approximated.

## Rollout

- **Phase 1 — core visual styles (biggest win).** Parse `xl/styles.xml`; map
  fills, borders, bold/italic/underline/strike, text color, alignment, number
  format; column widths / row heights / hidden. Store as per-cell `rangeStyles`.
  No model change.
- **Phase 2 — compaction + conditional formatting.** Coalesce range styles, lift
  col/row-uniform styles; import mappable conditional formats.
- **Phase 3 — model extension.** Add `CellStyle.ff`/`fs` (font family/size) and
  `Cell.lk` (hyperlink); wire renderer + toolbar + Yorkie schema.
- **Phase 4 — images & comments** (optional, largest surface).

## Risks and Mitigation

| Risk | Mitigation |
|---|---|
| One `rangeStyles` patch per cell bloats the Yorkie doc | Phase 1 coalesces adjacent per-cell patches (column then row) via `coalesceAdjacentRangeStylePatches`; Phase 2 adds col/row-uniform lifting. A hard patch-count cap with unstyled fallback is deferred to Phase 2. |
| Number-format heuristic misreads custom codes | Built-in id lookup first; heuristic only for custom ids; default to `plain` on ambiguity (never corrupt the value). |
| `CellStyle` field additions ripple across renderer/schema | Isolated in Phase 3; Phases 1–2 use only existing fields. |
| Theme-color resolution incomplete | Static indexed+theme fallback palette; document as approximate. |
| Large workbooks slow the client-side parse | Styles parsed once per workbook (not per cell) and resolved styles memoized per `s` index; reuse existing `DOMParser` path. |

## References

- Importer: `packages/sheets/src/import/xlsx-importer.ts`
- Frontend wiring: `packages/frontend/src/app/spreadsheet/xlsx-actions.ts`
- Model: `packages/sheets/src/model/workbook/worksheet-document.ts`,
  `packages/sheets/src/model/core/types.ts` (`CellStyle`, `NumberFormat`,
  `ConditionalFormatRule`), `packages/sheets/src/model/worksheet/range-styles.ts`
- [file-import.md](file-import.md) — parent import doc (defers this)
- [sheet-style.md](sheet-style.md) — style layers, merge & compaction semantics
- [data-validation.md](data-validation.md) — conditional-format / range-rule model
- ECMA-376 SpreadsheetML styles: `xl/styles.xml` (`fonts`/`fills`/`borders`/`cellXfs`/`dxfs`)
