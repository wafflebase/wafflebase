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
      validity). Layout reuses `computeLayout`; the header/footer **paint**
      path (`DocCanvas.renderHeaderFooterBlocks`) was text-run only and had
      to be extended to draw table blocks via the shared table renderer —
      without it an imported header table laid out but painted nothing.
- [ ] **7. Replace nested-table flattening with native rendering**

## 6b. Header/footer table CELL editing (follow-on to item 6)

Item 6 shipped render + crash-safety; the caret can't yet enter a
header/footer table cell. Wire interactive cell editing, reusing the body's
pure primitives (most navigation/merge helpers are already pagination-free;
see `text-editor.ts` `moveToNextCell`/`moveToPrevCell`/`moveCellLine`,
`selection.ts` `findMergeTopLeft`/`expandCellRangeForMerges`,
`table-geometry.ts` `computeMergedCellLineLayouts`/`getBlockIndexForLine`).

Header/footer tables are **single-band, non-paginated** (no split rows),
which removes the body's hardest geometry.

- [x] **P1 — Hit-test (click into a cell):** `getHFPositionFromMouse` now
      detects a click on a table block and calls `resolveHFCellOffset`,
      which maps table-local (x,y) → (row,col) via `layoutTable` offsets
      (merged cells walked to owner), then to a cell inner block + offset
      using `computeMergedCellLineLayouts` + `getBlockIndexForLine` + run
      measurement. Single-band (non-paginated) so no split-row logic.
- [x] **P2 — Caret render:** `computeHFCursorPixel` falls back to
      `computeHFTableCellCaretPixel` when the cursor blockId is a cell inner
      block (found via `hfLayout.blockParentMap`); computes the caret within
      the cell's lines at `baseY + lb.y + runLineY`, `columnXOffsets[col] +
      padding`.
- [x] **P3 — Selection render:** `computeHFSelectionRects` routes to
      `computeHFTableCellSelectionRects` when either endpoint is a cell
      (via `blockParentMap`): precise per-line rects for a within-cell text
      selection, whole-cell rects (`cellOriginPx`) for cross-cell ranges.
- [x] **P4 — Navigation:** made `getCellInfo`/`isInCell` and the cell-branch
      layout lookups use the **active** layout, so Arrow/Tab cell navigation
      engages in header/footer. Reused the model-based cell-movement
      primitives. Table-**exit** paths and structural row-add (`insertRow`,
      which assumes the body store path via `resolveTableBlock`) are guarded
      to body-only — header/footer arrows/Tab stay within the table rather
      than crashing or jumping into the body. Full structural row/col edits
      in header/footer tables remain a separate follow-up.

Verification: canvas paint/caret is browser-only (jsdom can't `getContext`);
pure geometry helpers get unit tests, the rest is manual smoke + browser
tests.

## Review (item 6)

- **Importer** (`docx-importer.ts` `parseHeaderFooter`): added a `tbl`
  branch mirroring the body walk; reuses `convertTable` so all the
  table-style work (borders inheritance, vAlign, trHeight, vMerge,
  gridBefore/After) applies inside header/footer cells too.
- **Exporter** (`docx-exporter.ts` `buildHeaderFooterXml`): no dispatch
  change needed (`blockToXml` already handles tables); added a trailing
  `<w:p/>` when the last header/footer block is a table.
- **Rendering** (`doc-canvas.ts`): the header/footer paint loop only drew
  text runs, so an imported header table was invisible (laid out but not
  painted). Extracted `renderHeaderFooterBlocks`, which routes table blocks
  through `renderTableBackgrounds`/`renderTableContent` (shared with the
  body) and draws everything else as runs; both header and footer loops now
  call it. Found via manual smoke test — caught because the data path
  (import → Yorkie round-trip → layout) was all verified correct yet the
  table still didn't appear.
- **Tests**: importer test imports a header table and asserts cell text;
  exporter test round-trips a header table and asserts the trailing
  `</w:tbl><w:p/>` and re-import fidelity. Canvas paint is covered by
  browser tests, not jsdom units.
- `pnpm verify:fast` green; manual smoke in `pnpm dev` to confirm the
  header table renders.
