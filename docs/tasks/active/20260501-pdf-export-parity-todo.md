# PDF export parity

## Goal

Make Docs PDF export preserve imported documents well enough for manual review:
text should remain readable, table content should not disappear, and page
fragments should match the Canvas renderer's behavior.

## Scope

- `packages/docs/src/export/pdf-painter.ts`
- `packages/docs/src/export/pdf-table-painter.ts`
- `packages/docs/src/export/pdf-style-map.ts`
- `packages/docs/src/export/pdf-fonts.ts`
- Related PDF export tests and fixtures as needed

## Steps

- [x] Create the feature plan in `docs/design/docs/docs-pdf-export-parity.md`.
- [x] Start from table content parity because imported DOCX tables are losing
      visible content.
- [x] Match Canvas table content row filtering for swept-back merged-cell page
      ranges.
- [x] Filter merged-cell text and list markers to the page row range currently
      being painted.
- [x] Render nested tables recursively in the PDF table content path instead
      of skipping `line.nestedTable`.
- [x] Match Canvas table render-start behavior so split-row fragments and the
      rows after them are not skipped by the PDF page loop.
- [x] Manually test the imported DOCX-derived document through web PDF export.
- [ ] Investigate remaining font fallback/glyph issues after table content is
      no longer disappearing.
- [ ] Add focused regression tests once the broken cases are understood.
- [ ] Run `pnpm verify:fast` before archiving.

## Notes

- Local targeted PDF tests currently fail before executing test bodies under
  Node 18 because jsdom pulls a CommonJS dependency that `require()`s an ESM
  module. Typecheck still passes.
- The table fixes intentionally follow Canvas table renderer behavior instead
  of inventing PDF-specific pagination rules.
