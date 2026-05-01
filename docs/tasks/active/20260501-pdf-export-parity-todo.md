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

## Guiding Principle

PDF export must not invent a second layout engine. It consumes
`computeLayout()` and `paginateLayout()` output, then translates page-local
coordinates into PDF drawing operations. The architecture itself is fixed and
documented in [`docs/design/docs/docs-pdf-export.md`](../../design/docs/docs-pdf-export.md);
this task only tightens the visible output to match the Canvas renderer.

## Phased Plan

### Phase 1 — Visual fixtures and review loop

Create a small fixture suite that covers the user-visible surfaces:

- `text-styles` — mixed Korean/English with bold, italic, underline,
  strikethrough, color, background, font size, font family, super/subscript.
- `headings-and-lists` — title, subtitle, headings, ordered/unordered lists,
  nested levels, links.
- `basic-table` — default table with borders, backgrounds, alignment, styled
  text in cells.
- `merged-table` — `colSpan`, `rowSpan`, covered placeholders, styled cell
  backgrounds.
- `split-row-table` — a tall row that splits across pages.
- `images-header-footer` — inline images, header/footer text, page numbers.
- `page-setup` — portrait/landscape with custom margins.

Exit: every fixture exports without throwing, reloads with `PDFDocument.load()`,
and page counts match expectations.

### Phase 2 — Font and text style fidelity

Stabilize text before tables; tables reuse the same text path.

- Latin-only documents skip Korean font fetch.
- Korean / CJK punctuation / list markers embed a Korean-capable font.
- Mixed-script runs split so Latin uses standard fonts and non-Latin uses Noto.
- Heading/title/subtitle defaults resolve before drawing.
- Baseline, underline, strikethrough, background rectangles match Canvas.
- Superscript/subscript use the same effective size and offset model.
- Hyperlink annotations cover the same glyph box that is drawn.

Exit: `text-styles` and `headings-and-lists` look correct in Preview/Chrome;
Korean text is selectable and searchable; link click targets line up.

### Phase 3 — Table chrome fidelity

Visible grid only — backgrounds, borders, merged geometry, page fragments.

- Default tables render visible borders even when cells omit border styles.
- Cell backgrounds painted before content and borders.
- Covered cells from merge placeholders are skipped.
- `colSpan` / `rowSpan` produce the same rectangles as Canvas.
- Split-row fragments are clipped to the page fragment height.
- Continuation fragments still render visible borders at the page boundary.

Exit: `basic-table`, `merged-table`, and `split-row-table` show correct grid
structure within the one-pixel tolerance.

### Phase 4 — Table cell content fidelity

- Cell text respects padding and vertical alignment.
- Cell paragraphs preserve inline styles, links, backgrounds, decorations.
- Ordered/unordered list markers render inside cells.
- Merged-cell content redistribution matches Canvas.
- Cell content in split rows is clipped to the visible fragment.
- Empty cells keep their default visual height.

Deferred unless explicitly pulled in: image crop/rotation inside cells.

Exit: table text in `basic-table`/`merged-table` matches expected placement;
list markers/indentation render inside cells; split-row content does not leak.

### Phase 5 — Images, headers, footers, page setup

- Inline images use layout-computed `run.width` / `run.imageHeight`.
- Image Y matches the Canvas bottom-aligned model.
- PNG/JPEG embed directly; other browser-decodable formats convert to PNG.
- Headers/footers render on every page with correct page-number substitution.
- Header/footer content clipped to its page region.
- Page size, orientation, margins match `PageSetup`.
- Heading outline entries point to the intended pages.

Deferred unless required: image rotation/crop, outline nesting by level,
Y-precise outline destinations.

Exit: `images-header-footer` and `page-setup` export correctly; page numbers
update per page; images align with Canvas in simple paragraph cases.

### Phase 6 — Regression coverage and ship gate

- Unit tests: font scanning, style→font mapping, color/link/page-number subs.
- PDF structure tests: page count, metadata, outline entries, annotations,
  image XObjects, embedded fonts.
- Fixture export tests: all canonical documents export without throwing.
- Manual coverage: Preview, Chrome, Adobe Reader (Korean rendering, search,
  table borders, page breaks, link click).

Exit: `pnpm verify:fast` passes; fixture PDFs pass manual QA for the release;
known unsupported behavior documented as follow-up.

## Status

- [x] Create the feature plan (now consolidated into this todo).
- [x] Start from table content parity because imported DOCX tables were losing
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

## Risks and Mitigation

- **PDF and Canvas use different font engines.** Keep layout measurement in
  Canvas, preload fonts before layout, and use PDF font mapping only for
  drawing.
- **Korean font files are large.** Keep loading conditional on `scanFontsUsed()`
  and track a separate follow-up for smaller static TTFs or backend subsetting.
- **Tables are easy to regress while fixing text.** Split table work into chrome
  and content phases, and keep `view/table-geometry.ts` authoritative.
- **Visual correctness is hard to assert in unit tests.** Use structure tests
  for fast feedback and a small manual fixture checklist for reader-specific
  behavior.
- **Unsupported features can look like bugs.** Document deferred behavior
  (e.g. image crop/rotation) until it is explicitly implemented.

## Notes

- Local targeted PDF tests currently fail before executing test bodies under
  Node 18 because jsdom pulls a CommonJS dependency that `require()`s an ESM
  module. Typecheck still passes.
- The table fixes intentionally follow Canvas table renderer behavior instead
  of inventing PDF-specific pagination rules.
