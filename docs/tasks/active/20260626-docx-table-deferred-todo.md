# DOCX table deferred follow-ups

**Status:** complete
**Parent:** `20260412-docx-table-style-followup` (archived)
**Scope:** `packages/docs/src/import/docx-importer.ts`,
`packages/docs/src/import/docx-style-map.ts`,
`packages/docs/src/export/docx-exporter.ts`,
`packages/docs/src/view/{table-renderer,doc-canvas,editor,text-editor}.ts`,
`packages/docs/src/model/document.ts`

## Background

Split out of `20260412-docx-table-style-followup` when its core work
(DOCX header/footer tables: import/export, rendering, and interactive cell
editing) shipped. These items were always "revisit later" and are not
blockers.

## Items

- [x] **5. `w:tblW` / `w:tcW`** — honor cell width overrides on import and
      export. **Import:** `<w:tcW>` (dxa) is now read in
      `mapTableCellProperties`; when a table has no `<w:tblGrid>`,
      `deriveColWidthsFromCells` derives column proportions from per-cell
      `tcW` (even-share fallback) — set as render-time `columnWidths` only,
      so the structural shape-hardening stays gated on the grid (gridless
      tests unchanged). **Export:** each `<w:tc>` now emits `<w:tcW>` (dxa,
      summed over spanned columns) before `<w:gridSpan>`. *Note:* absolute
      `<w:tblW>` is intentionally not honored — the docs `TableData` model has
      no absolute table width (fractional `columnWidths` fill the content
      area); adding one would be a model change beyond this follow-up.
- [x] **7. Replace nested-table flattening with native rendering** — the
      importer already imports nested tables as native `table` blocks
      (`convertTable` recurses on `<w:tbl>` cell children). Removed the stale
      "flattened to text" non-goal, the §2.5 flatten algorithm, and the
      warning-toast risk row in `docs-docx-import-export.md`; replaced §2.5
      with the native-recursion description.
- [x] **Structural row/column edits inside header/footer tables** — the table
      store ops were already region-aware (keyed by block id via `findBlock`).
      The real blockers were: body-only block-array access in
      `ensureBlockAfter` / `getPositionBeforeTable` / `getPositionAfterTable`
      (now `getContextBlocks()`); the `editContext === 'body'` guards in
      `moveToNextCell` / `moveToPrevCell` and the four arrow table-exit
      branches (dropped); and the editor API table commands resolving the
      cursor cell via the body-only `layout.blockParentMap` (switched to the
      merged `doc.blockParentMap`, plus region-aware `deleteTable` re-home).

## Header/footer table refinements (from PR #417 review)

Edge cases in the shipped header/footer cell editing; none are crashes or
common-path bugs.

- [x] **Page-number tokens inside header/footer table cells** —
      `renderTableContent` now takes an optional `pageNumber` and substitutes
      it for a `style.pageNumber` run's `#` placeholder (mirrors
      `renderRunWithPageNumber`); threaded from `renderHeaderFooterBlocks` and
      into nested-table recursion. *Note:* the canvas path is fixed; PDF
      export does not paint header/footer **tables** at all yet
      (`paintHFRegion` only walks `lb.lines`), so page-number-in-HF-table in
      PDF is moot until HF tables render in PDF — a separate, larger gap.
- [x] **`lineAffinity` in the HF cell caret/selection resolvers** — threaded
      `cursor.lineAffinity` into `computeHFTableCellCaretPixel` and
      `computeHFCursorPixel`; both now apply the forward-affinity
      wrap-boundary jump (start of next visual line) mirroring the body
      resolver `resolvePositionPixel`. All four call sites pass
      `cursor.lineAffinity`.
- [x] **Mixed table / non-table HF selections** — `computeHFSelectionRects`
      now has three branches: both-in-table (table path), neither (flat
      scan), and mixed (render the table cells clamped to the edge nearest the
      outside endpoint *plus* the flat paragraph run between that endpoint and
      the table boundary). Extracted `hfFlatLayoutRects` / `mapHFLayoutRects`
      helpers; `computeHFTableCellSelectionRects` clamps the whole-cell box to
      the table edge by document order when one endpoint is outside.

## Review

All six deferred items shipped in one PR. Implementation summary above.

A self code-review of the branch diff found no blocking bugs. One adjacent,
pre-existing correctness bug it surfaced was also fixed: the Delete /
Ctrl-Delete "merge with next block" paths resolved the sibling from the
body block array while `getBlockIndex` is context-aware, so deleting at the
end of a header/footer paragraph could no-op or throw "Cannot merge blocks
from different regions". Both sites now use `getContextBlocks()`
(`handleDelete`, `handleWordDelete`), with a regression test.

### Tests

- `pnpm --filter @wafflebase/docs typecheck` — clean.
- `pnpm --filter @wafflebase/docs test` — 62 files, 973 passing, 1 skipped.
- New/extended tests:
  - `test/import/docx-importer.test.ts` — tcW-derived columns without a
    tblGrid; even-share fallback; gridless gridBefore/gridAfter unchanged.
  - `test/export/docx-exporter.test.ts` — per-cell `<w:tcW>` dxa output.
  - `test/view/table-renderer.test.ts` — page-number substitution in cells.
  - `test/view/hf-caret-selection.test.ts` (new) — forward/backward affinity
    at a wrap boundary; mixed table/paragraph HF selection; pure-paragraph
    selection regression.
  - `test/view/header-table-nav.test.ts` — header-table insert/delete
    row/column, isInTable/getCellAddress, Tab-appends-row, ArrowRight exit.

### Known limitations / deferred

- Absolute `<w:tblW>` (dxa) is not honored on import — needs a `TableData`
  absolute-width model field; out of scope for this follow-up.
- PDF export still does not paint header/footer **tables** (`paintHFRegion`
  walks only `lb.lines`); page-number-in-HF-table in PDF depends on that
  larger feature.
- Mixed HF selection uses a bounding-box approximation for the table portion
  (matches the existing both-endpoints-in-table behavior), not a precise
  reading-order highlight.
