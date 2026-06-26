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
