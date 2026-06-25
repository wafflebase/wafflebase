# DOCX table style & exporter follow-up

**Status:** not-started
**Parent:** `20260411-docx-table-merge-gaps` (archived)
**Scope:** `packages/docs/src/import/docx-importer.ts`, `packages/docs/src/export/docx-exporter.ts`

## Background

Split from `20260411-docx-table-merge-gaps`. The merge-correctness items
(1–5) landed in PR #118. The remaining style/structure mappings and
exporter disambiguation are tracked here.

## Table style / structure gaps (priority: medium)

- [x] **1. `w:tcMar`** (cell margin/padding) — map to `CellStyle.padding`
      (importer only; max of specified dxa sides since the model carries
      one value)
- [x] **2. `w:vAlign`** (cell vertical alignment) — map to `CellStyle.verticalAlign`
      (importer only; OOXML "center" → model "middle")
- [x] **3. `w:tblBorders` inheritance** — fall back to table-level
      `tblBorders` when a cell has no `tcBorders` of its own
      (importer only; outer 4 sides for grid-edge cells, insideH/insideV
      for interior sides; covered merge placeholders skipped)
- [x] **4. `w:trHeight`** — map to `TableData.rowHeights`
      (importer only; hRule=auto skipped, atLeast/exact treated as minimum
      height matching model semantics)

## Exporter hardening

- [x] **E1. Disambiguate `colSpan === 0` in exporter** —
      `docx-exporter.ts` maps any covered placeholder to `<w:vMerge/>`.
      Fix to distinguish:
      - horizontal merge (absorbed by prior `gridSpan`) — skip tc
      - vertical merge (owner in earlier row) — emit `<w:vMerge/>`
      - `gridBefore`/`gridAfter` — emit via `trPr` skip markers
      Reconstructed at export time by walking each row's owners and
      checking rowSpan reach in prior rows; no model change needed.

## Revisit later

- [ ] **5. `w:tblW` / `w:tcW`** — honor table/cell width overrides
- [x] **6. Support tables inside header / footer parts** — importer
      `parseHeaderFooter` now dispatches `<w:tbl>` through `convertTable`
      with the part-scoped image map; exporter already routed header/footer
      blocks through `blockToXml` (handles tables), plus a trailing empty
      `<w:p/>` guard so a header/footer never ends with a table (OOXML
      validity). Render path reuses `computeLayout`, which already lays out
      table blocks for the body.
- [ ] **7. Replace nested-table flattening with native rendering**

## Review (item 6)

- **Importer** (`docx-importer.ts` `parseHeaderFooter`): added a `tbl`
  branch mirroring the body walk; reuses `convertTable` so all the
  table-style work (borders inheritance, vAlign, trHeight, vMerge,
  gridBefore/After) applies inside header/footer cells too.
- **Exporter** (`docx-exporter.ts` `buildHeaderFooterXml`): no dispatch
  change needed (`blockToXml` already handles tables); added a trailing
  `<w:p/>` when the last header/footer block is a table.
- **Tests**: importer test imports a header table and asserts cell text;
  exporter test round-trips a header table and asserts the trailing
  `</w:tbl><w:p/>` and re-import fidelity.
- `pnpm verify:fast` green.
