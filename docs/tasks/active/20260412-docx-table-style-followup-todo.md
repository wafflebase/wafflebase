# DOCX table style & exporter follow-up

**Status:** not-started
**Parent:** `20260411-docx-table-merge-gaps` (archived)
**Scope:** `packages/docs/src/import/docx-importer.ts`, `packages/docs/src/export/docx-exporter.ts`

## Background

Split from `20260411-docx-table-merge-gaps`. The merge-correctness items
(1–5) landed in PR #118. The remaining style/structure mappings and
exporter disambiguation are tracked here.

## Table style / structure gaps (priority: medium)

- [ ] **1. `w:tcMar`** (cell margin/padding) — map to `CellStyle.padding`
- [ ] **2. `w:vAlign`** (cell vertical alignment) — map to `CellStyle.verticalAlign`
- [ ] **3. `w:tblBorders` inheritance** — fall back to table-level
      `tblBorders` when a cell has no `tcBorders` of its own
- [ ] **4. `w:trHeight`** — map to `TableData.rowHeights`

## Exporter hardening

- [ ] **E1. Disambiguate `colSpan === 0` in exporter** —
      `docx-exporter.ts` maps any covered placeholder to `<w:vMerge/>`.
      Fix to distinguish:
      - horizontal merge (absorbed by prior `gridSpan`) — skip tc
      - vertical merge (owner in earlier row) — emit `<w:vMerge/>`
      - `gridBefore`/`gridAfter` — emit via `trPr` skip markers

## Revisit later

- [ ] **5. `w:tblW` / `w:tcW`** — honor table/cell width overrides
- [ ] **6. Support tables inside header / footer parts**
- [ ] **7. Replace nested-table flattening with native rendering**
