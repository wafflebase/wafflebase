---
title: docs-pdf-export
target-version: 0.4.0
---

# Docs PDF Export

## Summary

Add the ability to export the current `Document` from the Docs editor to a
vector PDF file alongside the existing DOCX export. The output is a real
PDF — selectable, searchable, with embedded fonts and clickable hyperlinks —
not a rasterized snapshot of the Canvas.

The implementation reuses the existing `paginateLayout()` pipeline so page
breaks, line breaks, table row splitting, header/footer placement, and
inline image positioning come "for free" from the same engine that drives
the on-screen renderer. PDF generation happens client-side via `pdf-lib` +
`@pdf-lib/fontkit`, with Korean fonts (Noto Sans/Serif KR) lazily fetched
and cached in IndexedDB.

### Goals

- Export the current `Document` to a valid PDF that opens in Adobe Reader,
  macOS Preview, Chrome, and Firefox.
- Vector text — selectable, copy/paste-able, full-text searchable.
- Embedded subset fonts so Korean text renders identically on any machine,
  regardless of installed system fonts.
- Feature parity with DOCX export: paragraphs, headings, lists, tables
  (including merged cells and split rows), inline images, headers/footers,
  page setup.
- PDF-native enhancements: clickable hyperlinks (from `InlineStyle.href`),
  document outline / bookmarks (from heading blocks), document metadata
  (title, author, creation date), dynamic page numbers (from existing
  `InlineStyle.pageNumber` field).
- No changes to the Docs data model — consume `Document` as-is.
- Reasonable performance: a 30-page mixed-content document exports in
  under ~5 seconds on a modern laptop.

### Non-Goals

- Pixel-perfect identity with the Canvas renderer (line breaks match, but
  glyph metrics may differ by ±1 px).
- Round-trip with DOCX export (the two formats share the model but are
  generated independently).
- Server-side PDF generation (entirely client-side).
- PDF/A, PDF/UA, or other certified PDF standards.
- PDF form fields, digital signatures, comments, redlines, or attachments.
- A general-purpose font library — only Noto Sans KR, Noto Serif KR, and
  pdf-lib's standard 14 fonts (Helvetica, Times, Courier).
- Italic Korean glyphs from a true italic font — Noto KR has no italic
  variant; `italic: true` on a Korean run is rendered as oblique
  (skewed regular).
- A "Print Preview" UI — the export menu produces a `.pdf` download
  directly, like DOCX.

## Proposal Details

### Architecture

```
┌──────────────┐   Document    ┌──────────────┐    Blob     ┌──────────────┐
│  DocStore    │ ────────────► │ PdfExporter  │ ──────────► │  Download    │
│  (editor)    │   PageSetup   │ (packages/   │             │  (browser)   │
│              │               │  docs)       │             │              │
└──────────────┘               └──────────────┘             └──────────────┘
                                     │
                              ┌──────┴────────┐
                              ▼               ▼
                        paginateLayout    pdf-lib +
                        (reused)          fontkit
                              │               │
                              ▼               ▼
                        PaginatedLayout   PDFDocument
                              ────────►   (per-page draw)
                                              │
                                              ├── ImageFetcher (shared with DOCX)
                                              └── FontLoader (lazy + IDB cache)
```

The key architectural seam: PDF export reuses the existing
`paginateLayout()` from `view/pagination.ts` rather than re-implementing
layout. `paginateLayout` already produces `LayoutPage[]` with per-line
`(x, y)` coordinates, header/footer placement, and table row split
metadata. The PDF painter walks this output and emits draw calls.

To keep glyph metrics consistent between Canvas measurement and PDF
output, the exporter forces `document.fonts.load()` for the Noto KR fonts
before invoking `paginateLayout` — Canvas's `measureText` and pdf-lib then
use the same font binaries.

Coordinate transform from Canvas (top-left origin, px) to PDF (bottom-left
origin, points):

```
pdfX     = canvasX × 72 / 96
pdfY     = pageHeightInPoints - (canvasY × 72 / 96)
pdfWidth = canvasWidth × 72 / 96
```

The Docs model stores `fontSize` in points already, so font sizes pass
through unchanged.

### Module Structure

```
packages/docs/src/export/
  docx-exporter.ts             # existing
  docx-style-map.ts            # existing
  docx-templates.ts            # existing
  pdf-exporter.ts              # NEW — entry point, orchestrates pipeline
  pdf-painter.ts               # NEW — LayoutPage → pdf-lib draw calls
  pdf-style-map.ts             # NEW — InlineStyle/BlockStyle → pdf-lib opts
  pdf-fonts.ts                 # NEW — lazy fetch, IDB cache, fontkit subset
  pdf-table-painter.ts         # NEW — table-renderer.ts equivalent for PDF
  pdf-image-painter.ts         # NEW — embed PNG/JPEG, convert GIF/WebP/BMP
```

Separation rationale:

- `pdf-exporter.ts` — Public API. Mirrors `DocxExporter.export(doc, opts)`
  signature so frontend integration stays symmetric.
- `pdf-painter.ts` — Consumes `PaginatedLayout`, draws text per page.
  Delegates tables and images to dedicated painters to keep file sizes
  bounded (matches the existing split between `doc-canvas.ts` and
  `table-renderer.ts`).
- `pdf-fonts.ts` — Font handling is orthogonal to drawing and has its own
  cache lifecycle (IDB), error modes (network), and dependency (fontkit).
  Isolating it makes the painter testable without IDB.
- `pdf-style-map.ts` — Pure-function conversions (`color string → RGB`,
  `fontFamily → PdfFontKey`). Easy to unit test in isolation.

### Public API

```ts
// packages/docs/src/export/pdf-exporter.ts

export interface PdfExportOptions {
  /** Required when document contains image inlines. Same fetcher used by
      DocxExporter — frontend can pass the same instance to both. */
  imageFetcher?: ImageFetcher;
  /** Optional metadata. Defaults: title from doc, author empty,
      creationDate = now. */
  metadata?: {
    title?: string;
    author?: string;
    subject?: string;
    keywords?: string[];
  };
}

export class PdfExporter {
  static async export(
    doc: Document,
    options?: PdfExportOptions,
  ): Promise<Blob>;
}
```

`ImageFetcher` is reused as-is from the existing DOCX export module.

### Export Pipeline

```
PdfExporter.export(doc, opts)
  │
  ├─ 1. scanFontsUsed(doc)          → { needsKR, needsKRSerif, needsBold, ... }
  ├─ 2. PdfFonts.loadRequired(set)  → IDB lookup → fetch on miss → ArrayBuffer
  │                                  → also document.fonts.load() for Canvas
  ├─ 3. layoutDocument + paginateLayout(doc)  → PaginatedLayout
  ├─ 4. collectAndFetchImages(doc, imageFetcher)
  │                                  → Map<src, { bytes, mime, w, h }>
  ├─ 5. PDFDocument.create() + registerFontkit(fontkit)
  │     embedFont(buf, { subset: true }) for each used font
  │     embedPng/Jpg(bytes) for each image
  ├─ 6. PdfPainter.paintPage(page, pdfPage) for each LayoutPage
  ├─ 7. setMetadata(doc, opts) + addOutlineFromHeadings(doc)
  └─ 8. pdfDoc.save() → Uint8Array → new Blob([bytes], { type: 'application/pdf' })
```

Each step takes plain-object input and produces plain-object output, so
they can be unit-tested independently. The painter (step 6) is the only
one that mutates pdf-lib state.

### Font Strategy

Four PDF fonts cover all Docs content:

| PDF Font Key            | Source                  | Purpose                          |
|-------------------------|-------------------------|----------------------------------|
| `sans-{regular,bold,italic,boldItalic}` | pdf-lib standard Helvetica family | Latin sans-serif |
| `serif-{regular,bold,italic,boldItalic}` | pdf-lib standard Times family    | Latin serif      |
| `kr-sans-{regular,bold}` | Noto Sans KR (fetched)  | Korean sans-serif (incl. CJK)    |
| `kr-serif-{regular,bold}` | Noto Serif KR (fetched) | Korean serif                     |

`InlineStyle.fontFamily` is mapped to one of these via the same fallback
logic as `view/fonts.ts`:

```ts
function resolveFontKey(style: InlineStyle, runHasCJK: boolean): PdfFontKey {
  const isSerif = SERIF_FONTS.has(style.fontFamily ?? 'Arial');
  const isBold  = !!style.bold;
  const isItalic = !!style.italic;
  if (runHasCJK) {
    return isSerif
      ? (isBold ? 'kr-serif-bold' : 'kr-serif-regular')
      : (isBold ? 'kr-sans-bold'  : 'kr-sans-regular');
  }
  // ... 4-way Latin selection
}
```

**Run splitting.** A single `LayoutRun` whose text mixes Korean and Latin
(`"Hello 안녕 World"`) is split at script boundaries and drawn with
different fonts back-to-back, so the Latin portion uses the slim
Helvetica subset rather than the heavier Noto KR. Boundary regex:

```ts
/[\u3000-\u9FFF\uAC00-\uD7AF\uFF00-\uFFEF]+|[^\u3000-\u9FFF\uAC00-\uD7AF\uFF00-\uFFEF]+/g
```

**Italic on Korean.** Noto KR ships no italic variant. When `italic: true`
on a Korean run, the painter draws the regular variant with a 12° text
matrix skew using pdf-lib's low-level `pushOperators` (the high-level
`drawText` has no transform option).

**Lazy font fetch.**

| File                       | Source              | Size (raw) |
|----------------------------|---------------------|-----------|
| `NotoSansKR-Regular.ttf`   | Google Fonts CDN    | ~5.5 MB   |
| `NotoSansKR-Bold.ttf`      | "                   | ~5.5 MB   |
| `NotoSerifKR-Regular.otf`  | "                   | ~6 MB     |
| `NotoSerifKR-Bold.otf`     | "                   | ~6 MB     |

On the first export, `PdfFonts` looks up each required font in IndexedDB;
on a miss it fetches from Google Fonts and stores the `ArrayBuffer`.
Subsequent exports are instant. Documents with no Korean content skip
the KR fetch entirely (determined in step 1, `scanFontsUsed`). After
fontkit subsetting, only the glyphs actually used in the document are
embedded — typical resulting PDF size is 50–200 KB per page, including
Korean text.

### Style Mapping

`paginateLayout` already applies block-level styles (alignment, indent,
line spacing, margins) when computing line `(x, y)` coordinates, so the
PDF painter does not re-apply them. It only handles inline styles and a
small set of block adjuncts.

| `InlineStyle`        | PDF rendering                                               |
|----------------------|-------------------------------------------------------------|
| `fontSize`           | `drawText({ size })` — pt passes through                    |
| `color`              | `drawText({ color: rgb(r/255, g/255, b/255) })`             |
| `backgroundColor`    | `drawRectangle` behind text at run extent                   |
| `bold` / `italic`    | Font key variant (or skew matrix for Korean italic)         |
| `underline`          | `drawLine` 1pt below baseline, `width = run.width`          |
| `strikethrough`      | `drawLine` at `baseline + ascent / 2`                       |
| `superscript`        | `size × 0.7`, `y += ascent × 0.4`                           |
| `subscript`          | `size × 0.7`, `y -= ascent × 0.2`                           |
| `href`               | After draw, add link annotation rect over the run extent    |
| `pageNumber`         | Substitute run text with current page number, then draw     |
| `image`              | Delegate to `pdf-image-painter`                             |

Block-level adjuncts handled in PDF directly:

- **List markers** (`•`, `1.`, etc.) — the painter calls
  `computeListCounters(blocks)` from `view/layout.ts` (the same helper
  used by `doc-canvas.ts:213`) to get a `Map<blockId, markerText>`, then
  draws the marker text in the gutter before each list item's body runs.
- **Headings → outline** — independent of drawing, walk `Document.blocks`
  for `type: 'heading'` and add to PDF outline tree (level mapped from
  heading level 1–6).

### Tables

`pdf-table-painter` is the PDF analogue of `view/table-renderer.ts`. It
receives the same `LayoutPage`/`PageLine` data the Canvas renderer uses,
including `pl.rowSplitOffset` and `pl.rowSplitHeight` for rows that span
page boundaries.

Draw order per table fragment on a page:

1. Cell backgrounds (`drawRectangle` with `style.backgroundColor`)
2. Cell borders (`drawLine` × 4 per visible edge, respecting `tcBorders`)
3. Cell content (delegate runs back to the main painter, with the cell's
   inner clip rectangle as bounds)

Merged cells (`colSpan` / `rowSpan`) follow the same coordinate logic as
`table-renderer.ts:computeTableRangeForPageLine` — that file's geometry
helpers are extracted into a shared `view/table-geometry.ts` so both
renderers depend on the same source of truth.

### Images

pdf-lib supports PNG and JPEG natively. Other formats (`gif`, `webp`,
`bmp`) are rasterized once via Canvas (`HTMLImageElement` already cached
in `view/image-cache.ts`, then `canvas.toBlob('image/png')`) and embedded
as PNG.

Coordinates and dimensions come straight from the `LayoutRun` produced by
`paginateLayout`, so image scaling and aspect ratios match the Canvas
output exactly.

### Hyperlinks

`InlineStyle.href` is already on the model. The painter, after drawing
each run with a non-empty `href`, calls pdf-lib's link annotation API:

```ts
page.node.set(
  PDFName.of('Annots'),
  pdfDoc.context.obj([
    ...existingAnnots,
    pdfDoc.context.obj({
      Type: 'Annot', Subtype: 'Link',
      Rect: [x1, y1, x2, y2],
      Border: [0, 0, 0],
      A: { Type: 'Action', S: 'URI', URI: PDFString.of(href) },
    }),
  ]),
);
```

The `Rect` matches the run's draw rectangle (same coordinates used for
`underline`).

### Page Numbers and Headers/Footers

`paginateLayout` already produces header/footer regions per page using
`getHeaderYStart` / `getFooterYStart`. Each header/footer is a mini
`Document.blocks` that gets laid out per page with the current page
number substituted into any inline whose `style.pageNumber === true`
(this is the same logic at `doc-canvas.ts:651`). The PDF painter
substitutes identically before drawing.

### Frontend Integration

The frontend already has DOCX export wired up at
`packages/frontend/src/app/docs/docx-actions.ts`. The shared bits
(`docxImageFetcher`, `downloadBlob`, `pickFile`, base-URL resolution)
move into a new `export-utils.ts`:

```
packages/frontend/src/app/docs/
  export-utils.ts        # NEW — shared image fetcher, downloadBlob
  docx-actions.ts        # delegates to export-utils
  pdf-actions.ts         # NEW — exportPdfAndDownload(doc, title, opts)
```

The export menu (currently single DOCX button) becomes a dropdown:

```
[Export ▾]
   ├ DOCX (.docx)
   └ PDF  (.pdf)
```

The PDF menu item dynamically imports the PDF module so the +200 KB of
pdf-lib + fontkit doesn't enter the initial bundle:

```ts
async function exportPdf(doc, title) {
  const { exportPdfAndDownload } = await import('./pdf-actions');
  await exportPdfAndDownload(doc, title);
}
```

### Error Handling

| Failure                  | Behavior                                                        |
|--------------------------|-----------------------------------------------------------------|
| Font fetch fails         | Throw with clear message; toast prompts user to check network   |
| Image fetch fails        | Match DOCX behavior — throw (consistent across formats)         |
| Empty document           | Single empty PDF page (matches DOCX)                            |
| Unsupported image format | Convert to PNG via Canvas; if conversion fails, throw           |
| Document with no fonts   | Skip font fetch entirely; use only pdf-lib standard fonts       |

### Testing

| Layer            | Tool             | Focus                                                  |
|------------------|------------------|--------------------------------------------------------|
| Unit (style-map) | Vitest           | `InlineStyle → PdfFontKey`, RGB conversion             |
| Unit (font scan) | Vitest           | `scanFontsUsed(doc)` correctness                       |
| Unit (run split) | Vitest           | Mixed-script splitting boundaries                      |
| Integration      | Vitest + pdf-lib | Re-load exported PDF, verify pages/text/fonts          |
| Visual (manual)  | Adobe / Preview  | See verification checklist                             |

Test fixtures in `packages/docs/src/export/__tests__/fixtures/`:

- `simple-paragraph.json`
- `mixed-korean-english.json`
- `with-table.json`
- `with-merged-cells.json`
- `with-split-row.json`
- `with-image.json`
- `multi-page.json`
- `with-headings-and-links.json`
- `with-header-footer-pagenumber.json`

`PdfFonts` accepts dependency-injected font `ArrayBuffer`s in tests, so
Vitest in Node can load fixture font files via `fs.readFileSync` instead
of going through the browser IDB path.

**Manual verification checklist** (recorded in the task's lessons file
at completion):

- [ ] Korean text renders correctly in Adobe Reader
- [ ] Korean text renders correctly in macOS Preview
- [ ] Text copy/paste produces real Unicode (not glyph IDs)
- [ ] Cmd+F search finds Korean and Latin text
- [ ] Hyperlinks open in default browser
- [ ] PDF outline panel shows heading hierarchy
- [ ] Print preview pagination matches on-screen pagination
- [ ] 30-page mixed document exports under 5 seconds

### File Structure

```
packages/docs/src/
  export/
    pdf-exporter.ts
    pdf-painter.ts
    pdf-style-map.ts
    pdf-fonts.ts
    pdf-table-painter.ts
    pdf-image-painter.ts
    __tests__/
      pdf-style-map.test.ts
      pdf-fonts.test.ts
      pdf-painter.test.ts
      pdf-exporter.test.ts
      fixtures/
        *.json
        fonts/
          NotoSansKR-Regular.ttf      # for unit tests only, not bundled
          NotoSansKR-Bold.ttf
          NotoSerifKR-Regular.otf
          NotoSerifKR-Bold.otf
  view/
    table-geometry.ts                 # extracted from table-renderer.ts

packages/frontend/src/app/docs/
  export-utils.ts
  pdf-actions.ts
  docx-actions.ts                     # refactored to use export-utils
```

### Phased Implementation

1. **Phase 1 — Foundations.** `pdf-fonts.ts` (fetch + IDB + subset),
   `scanFontsUsed`, font-key resolution. Milestone: hello-world PDF with
   one line of Korean.
2. **Phase 2 — Text + inline styles.** `pdf-style-map.ts`, `pdf-painter.ts`
   for paragraphs only. Mixed-script run splitting; bold/italic/underline/
   strike/sup/sub/color/bg/href. Milestone: text-only documents export
   correctly.
3. **Phase 3 — Pages + header/footer + page numbers.** Multi-page docs,
   header/footer regions, `pageNumber` inline substitution. Milestone:
   `multi-page.json` and `with-header-footer-pagenumber.json` pass.
4. **Phase 4 — Tables.** `pdf-table-painter.ts` with merged cells and
   row splits. Extract `view/table-geometry.ts` shared with Canvas.
5. **Phase 5 — Images.** `pdf-image-painter.ts` with PNG/JPEG native and
   GIF/WebP/BMP via Canvas conversion.
6. **Phase 6 — PDF-native features.** Metadata, heading-driven outline
   tree, hyperlink annotations on `href` runs.
7. **Phase 7 — Frontend integration.** Extract `export-utils.ts`, add
   `pdf-actions.ts`, dropdown menu, dynamic import for lazy load.

### Risks and Mitigation

| Risk                                                      | Impact                            | Mitigation                                                                                             |
|-----------------------------------------------------------|-----------------------------------|--------------------------------------------------------------------------------------------------------|
| Glyph metric drift between Canvas measureText and pdf-lib | Run end-positions slightly off    | Force `document.fonts.load()` for Noto KR before `paginateLayout`; both engines then use same binaries |
| Font fetch failure (CDN down, offline)                    | Export fails outright             | IDB cache after first fetch; clear error message; future option to self-host fonts                     |
| Italic Korean is oblique-only                             | Slightly artificial appearance    | Documented limitation; rare in practice (DOCX import seldom carries italic Korean)                     |
| GIF/WebP/BMP not native in pdf-lib                        | Image missing or export fails     | Canvas → PNG conversion fallback (HTMLImageElement already cached)                                     |
| Large documents (100+ pages) memory/CPU                   | Slow or OOM                       | Per-page incremental draw; subset fonts once; lazy-load PDF module via dynamic import                  |
| Bundle size +200 KB                                       | Initial app load                  | Dynamic import — only fetched when user clicks "Export PDF"                                            |
| Table row-split borders misaligned across pages           | Visual artifact                   | Reuse `pl.rowSplitOffset` / `pl.rowSplitHeight` directly; fixture covers the case                      |
| Hyperlink rect mis-aligned                                | Wrong click target                | Reuse same rect math as underline; fixture verifies hit area                                           |
| Korean font licensing                                     | Legal blocker for redistribution  | Noto fonts are SIL OFL; reject `Malgun Gothic` / `Batang` redistribution paths                         |
| pdf-lib + fontkit subsetting bug on CJK                   | Garbled glyphs in PDF             | Integration test re-parses PDF and verifies a CJK roundtrip on every fixture                           |
