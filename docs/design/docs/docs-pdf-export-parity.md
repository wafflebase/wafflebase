---
title: docs-pdf-export-parity
target-version: 0.4.1
---

# Docs PDF Export Parity Plan

## Summary

PDF export already follows the right architecture: it reuses the Docs layout
and pagination pipeline, then paints the result into a vector PDF with
`pdf-lib`. The remaining work is export parity: making the PDF output preserve
the visible document faithfully enough that users can trust exported files for
sharing, printing, and review.

This plan is organized by user-visible features rather than by implementation
files. Each phase should tighten one visible surface, add focused fixtures, and
leave behind a repeatable verification path.

## Goals

- Preserve visible text styling: font family, size, weight, italic, underline,
  strikethrough, text color, background color, superscript, and subscript.
- Render Korean, Latin, CJK punctuation, and list markers without garbled
  glyphs or missing characters.
- Keep paragraph wrapping, baselines, and page breaks close to the Canvas
  editor output.
- Render tables with correct borders, backgrounds, merged cells, split rows,
  padding, vertical alignment, and cell content.
- Render inline images in the expected position and size.
- Preserve document-level features: page setup, margins, headers, footers,
  page numbers, hyperlinks, metadata, and heading outline entries.
- Build fixture-based verification so future PDF regressions are easy to spot.

## Non-Goals

- Replacing the current client-side `pdf-lib` exporter.
- Making PDF output pixel-identical to Canvas at every glyph edge.
- Round-tripping PDF back into the Docs model.
- PDF/A, PDF/UA, form fields, comments, signatures, or accessibility tagging.
- Reworking the Yorkie `Tree` data model. PDF export consumes the current
  `Document` model produced by `DocStore.getDocument()`.

## Current Pipeline

```text
Editor DocStore
  -> Document snapshot
  -> PdfExporter.export()
  -> scan fonts and load required font binaries
  -> computeLayout()
  -> paginateLayout()
  -> collect and embed images
  -> PdfPainter.paintPage() for each LayoutPage
  -> pdfDoc.save()
  -> Blob download
```

The most important contract is that PDF export must not invent a second layout
engine. It should consume `computeLayout()` and `paginateLayout()` output, then
translate the resulting page-local coordinates into PDF drawing operations.

## Phase 1: Visual Fixtures and Review Loop

Create a small export fixture suite that represents the user-visible surfaces
we care about. These fixtures should be simple enough to inspect manually and
stable enough to use in regression tests.

Fixture set:

- `text-styles`: mixed Korean and English text with bold, italic, underline,
  strikethrough, color, background, font size, font family, superscript, and
  subscript.
- `headings-and-lists`: title, subtitle, headings, ordered lists, unordered
  lists, nested list levels, and links.
- `basic-table`: default inserted table with borders, backgrounds, alignment,
  and styled text in cells.
- `merged-table`: `colSpan`, `rowSpan`, covered placeholders, and styled cell
  backgrounds.
- `split-row-table`: a tall row that splits across pages.
- `images-header-footer`: inline images, header text, footer text, and page
  number tokens.
- `page-setup`: portrait and landscape pages with custom margins.

Verification outputs:

- PDF files generated from each fixture.
- Optional browser-rendered snapshots of the same `Document` in the Docs canvas
  harness.
- A short manual QA checklist for Preview, Chrome, and Adobe Reader.

Exit criteria:

- Every fixture can export without throwing.
- Generated PDFs reload with `PDFDocument.load()`.
- Page counts match expectations.
- Manual inspection has a known place to record failures.

## Phase 2: Font and Text Style Fidelity

Stabilize text before table work. Tables reuse the same text drawing path, so
font and baseline issues should be solved at the paragraph level first.

Feature requirements:

- Latin-only documents export without fetching Korean fonts.
- Documents with Korean, CJK punctuation, or unordered list markers embed a
  Korean-capable font before those glyphs are drawn.
- Mixed-script runs split into PDF-safe segments so Latin uses standard fonts
  and non-Latin glyphs use embedded Korean fonts.
- Heading, title, and subtitle defaults are resolved before PDF drawing.
- Baseline, underline, strikethrough, and background rectangles match the
  Canvas renderer's visual model.
- Superscript and subscript use the same effective size and offset model in
  PDF as in Canvas.
- Hyperlink annotations cover the same glyph box that is drawn.

Implementation focus:

- Keep `pdf-style-map.ts` aligned with `view/theme.ts` and `view/fonts.ts`.
- Keep `pdf-fonts.ts` scanning in sync with every glyph source used by
  `pdf-painter.ts`, including list markers and page number substitutions.
- Avoid special casing text layout in the PDF painter. Text positions should
  come from `LayoutRun` and `PageLine`.

Exit criteria:

- `text-styles` and `headings-and-lists` look correct in Preview and Chrome.
- Korean text can be selected and searched in at least one PDF reader.
- Link annotations are present and click targets line up with visible text.

## Phase 3: Table Chrome Fidelity

Render table structure independently from table cell text. This phase is about
the visible grid: backgrounds, borders, merged geometry, and page fragments.

Feature requirements:

- Default tables render visible borders even when cells omit explicit border
  styles.
- Cell backgrounds are painted before cell content and borders.
- Covered cells from merge placeholders are skipped.
- `colSpan` and `rowSpan` produce the same cell rectangles as Canvas.
- Split row fragments are clipped to the page fragment height.
- Continuation fragments still render visible borders at the page boundary.

Implementation focus:

- Treat `view/table-geometry.ts` as the shared source for table range and cell
  rectangle semantics.
- Keep PDF draw order compatible with Canvas: backgrounds, content, borders.
- Convert table-local px coordinates to page-local PDF points in one place.

Exit criteria:

- `basic-table`, `merged-table`, and `split-row-table` show correct grid
  structure before cell text polish.
- Table borders and backgrounds visually match the Canvas harness within the
  expected one-pixel tolerance.

## Phase 4: Table Cell Content Fidelity

Once table chrome is stable, make content inside cells match regular document
content.

Feature requirements:

- Cell text respects padding and vertical alignment.
- Cell paragraphs preserve inline styles, links, backgrounds, and decorations.
- Ordered and unordered list markers render inside cells.
- Merged-cell content redistribution matches the Canvas table renderer.
- Cell content in split rows is clipped to the visible fragment.
- Empty cells keep their default visual height.

Deferred unless explicitly pulled into this phase:

- Nested tables inside cells.
- Image crop and rotation inside cells.

Exit criteria:

- Table text in `basic-table` and `merged-table` matches expected placement.
- Lists inside table cells render markers and indentation correctly.
- Split-row table content does not leak above or below the page fragment.

## Phase 5: Images, Headers, Footers, and Page Setup

Polish document-level export features after body text and tables are stable.

Feature requirements:

- Inline images use the layout-computed `run.width` and `run.imageHeight`.
- Image Y positioning matches the Canvas bottom-aligned model.
- PNG and JPEG embed directly; other browser-decodable formats convert to PNG.
- Headers and footers render on every page with correct page number
  substitution.
- Header and footer content is clipped to its page region.
- Page size, orientation, and margins match `PageSetup`.
- Heading outline entries are present and point to the intended pages.

Deferred unless required for the release:

- Image rotation and cropping.
- Heading outline nesting by level.
- Y-precise outline destinations.

Exit criteria:

- `images-header-footer` and `page-setup` export correctly.
- Page numbers update per page.
- Images align with the Canvas harness in simple paragraph cases.

## Phase 6: Regression Coverage and Ship Gate

Turn the fixture work into an ongoing guardrail.

Automated coverage:

- Unit tests for font scanning and style-to-font mapping.
- Unit tests for PDF color, link annotation, and page number substitution.
- PDF structure tests for page count, metadata, outline entries, annotations,
  image XObjects, and embedded font presence.
- Fixture export tests that ensure all canonical documents export without
  throwing.

Manual coverage:

- Preview: visual check, Korean rendering, copy text, search text.
- Chrome: visual check and link click behavior.
- Adobe Reader: Korean rendering, search text, table borders, page breaks.

Exit criteria:

- `pnpm verify:fast` passes.
- Fixture PDFs pass the manual QA checklist for the release target.
- Known unsupported behavior is documented as follow-up rather than left as an
  ambiguous rendering bug.

## Implementation Order

1. Add visual fixtures and a repeatable export/review path.
2. Fix font selection, glyph coverage, baseline, and text decoration parity.
3. Fix table chrome: borders, backgrounds, merged cell rectangles, split-row
   clipping.
4. Fix table cell content: padding, vertical alignment, markers, and clipping.
5. Fix images, headers, footers, page setup, and outline polish.
6. Expand regression tests and record manual QA results.

## Risks and Mitigation

- **PDF and Canvas use different font engines.** Keep layout measurement in
  Canvas, preload fonts before layout, and use PDF font mapping only for
  drawing.
- **Korean font files are large.** Keep loading conditional on `scanFontsUsed()`
  and track a separate follow-up for smaller static TTFs or backend subsetting.
- **Tables are easy to regress while fixing text.** Split table work into chrome
  and content phases, and keep shared geometry helpers authoritative.
- **Visual correctness is hard to assert in unit tests.** Use structure tests
  for fast feedback and a small manual fixture checklist for reader-specific
  behavior.
- **Unsupported features can look like bugs.** Document deferred behavior, such
  as nested table PDF rendering and image crop/rotation, until it is explicitly
  implemented.
