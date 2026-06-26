# DOCX table deferred follow-ups

**Status:** not-started
**Parent:** `20260412-docx-table-style-followup` (archived)
**Scope:** `packages/docs/src/import/docx-importer.ts`,
`packages/docs/src/export/docx-exporter.ts`,
`packages/frontend/src/app/docs/yorkie-doc-store.ts`

## Background

Split out of `20260412-docx-table-style-followup` when its core work
(DOCX header/footer tables: import/export, rendering, and interactive cell
editing) shipped. These items were always "revisit later" and are not
blockers.

## Items

- [ ] **5. `w:tblW` / `w:tcW`** — honor table/cell width overrides on
      import (and likely export).
- [ ] **7. Replace nested-table flattening with native rendering** — the
      importer already imports nested tables as native `table` blocks (see
      the `should import nested tables` test); audit the remaining
      flattening claims in `docs-docx-import-export.md` and remove the stale
      "flattened to text" path / warning.
- [ ] **Structural row/column edits inside header/footer tables** — Tab at
      the last header/footer cell, and insert/delete row/column, currently
      no-op in header/footer because the table store ops
      (`resolveTableBlock` / `findTableIndex` / `resolveTableTreePath`)
      assume the body path. Make them region-aware, then drop the
      `editContext === 'body'` guards in `text-editor.ts`
      (`moveToNextCell` / `moveToPrevCell` and the arrow table-exit branches).

## Header/footer table refinements (from PR #417 review)

Edge cases in the shipped header/footer cell editing; none are crashes or
common-path bugs.

- [ ] **Page-number tokens inside header/footer table cells** — a
      `pageNumber: true` inline in a cell renders its `#` placeholder, not
      the page number. `renderTableContent` (`table-renderer.ts`, shared
      with the body + PDF painter) draws `run.text` directly; thread an
      optional `pageNumber` through and substitute like
      `renderRunWithPageNumber`, then pass it from
      `renderHeaderFooterBlocks`.
- [ ] **`lineAffinity` in the HF cell caret/selection resolvers** —
      `computeHFTableCellCaretPixel` resolves `remaining === lineChars` to
      the previous visual line, so the caret at a wrap boundary can render
      on the prior line for forward affinity (wrapped multi-line cells). The
      existing header *paragraph* caret (`computeHFCursorPixel`) has the same
      limitation — fix both by threading `cursor.lineAffinity` through.
- [ ] **Mixed table / non-table HF selections** — when a selection spans a
      cell and an outside header/footer paragraph,
      `computeHFTableCellSelectionRects` collapses both endpoints to the one
      in-table cell and drops the paragraph portion. Split rendering between
      the flat HF path and the table path (or clamp the outside endpoint to
      the table edge by document order).
