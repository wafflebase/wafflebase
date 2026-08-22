---
title: docs-docx-import-export
target-version: 0.3.2
---

# DOCX Import / Export

## Summary

Import Microsoft Word (.docx) files into the Docs editor and export documents
back to .docx format. This is **shipped** (released in v0.3.2): the importer
lives at `packages/docs/src/import/docx-importer.ts`, the exporter at
`packages/docs/src/export/docx-exporter.ts`. It builds on three supporting
features that also shipped: inline images (`ImageData` + `image` field on
`InlineStyle` in `model/types.ts`), image resource management (the backend
S3/MinIO `image` module), and web font loading for Korean typefaces
(`packages/docs/src/view/fonts.ts`).

The phases below describe the design as it was built; they are retained as an
architectural reference, not a forward-looking plan.

## Goals

- Import a .docx file and produce an editable `Document` (blocks, tables,
  styles, images, headers/footers, page setup).
- Export the current `Document` back to a valid .docx file that opens in
  Word / Google Docs.
- Support inline images backed by S3-compatible object storage.
- Render Korean web fonts (Malgun Gothic, Batang, etc.) with a fallback chain.

## Non-Goals

- Round-trip fidelity (preserving every Word-specific attribute is not a goal).
- Floating / anchored images — only inline images are in scope.
- Form controls, SmartArt, WordArt, embedded OLE objects.
- Comments, track changes, footnotes/endnotes.
- Real-time collaborative import (single-user import, then collaborate).

---

## Phase 1 — Prerequisite Features

### 1.1 Inline Image Support

#### Model Changes

Add an `image` field to `InlineStyle` and introduce an `ImageData` type:

```typescript
// model/types.ts

export interface ImageData {
  src: string;         // URL to the image resource
  width: number;       // Display width in pixels
  height: number;      // Display height in pixels
  alt?: string;        // Accessible alt text
}

export interface InlineStyle {
  // ... existing fields ...
  image?: ImageData;   // When set, this inline is an image, text is ignored
}
```

An image inline is a single `Inline` element whose `text` is the Unicode
Object Replacement Character (`\uFFFC`) and whose `style.image` carries the
image metadata. This approach:

- Keeps the `Block → Inline[]` hierarchy unchanged.
- Images participate naturally in cursor navigation (offset +1 per image).
- Selection, delete, copy/paste work with no structural changes.
- Layout and rendering treat the image as a measured inline element.

#### Layout Changes (`layout.ts`)

During word-wrap, when an inline has `style.image`:

1. Use `image.width` and `image.height` instead of `measureText`.
2. The image inline is never word-broken — it stays as a single unit.
3. If the image is wider than the content area, scale it down proportionally.

#### Rendering Changes (`doc-canvas.ts`)

1. Maintain an `ImageCache` (`Map<string, HTMLImageElement>`) to avoid
   re-fetching on every repaint.
2. When rendering an inline with `style.image`, call
   `ctx.drawImage(cachedImg, x, y, width, height)`.
3. Images load asynchronously — trigger a re-render when the `onload` fires.

#### Editing Behavior

| Action | Behavior |
|--------|----------|
| Cursor movement | Arrow keys skip over the image (offset +1) |
| Backspace / Delete | Removes the image inline |
| Selection | Image is part of the selection range |
| Copy / Paste | Copies image URL; paste re-inserts the image inline |
| Typing at image position | Text is inserted before/after the image |

### 1.2 Image Resource Management

#### Architecture

```
┌────────────┐     POST /images      ┌──────────────┐     PutObject     ┌──────────┐
│  Frontend   │ ──────────────────►   │   Backend    │ ─────────────────► │  S3 /    │
│  (upload)   │ ◄────────────────── │  ImageModule │ ◄───────────────── │  MinIO   │
│             │    { url, id }      │              │    stored          │          │
└────────────┘                      └──────────────┘                    └──────────┘
```

#### Backend — ImageModule

New NestJS module at `packages/backend/src/image/`:

```
image/
  image.module.ts        # Module definition, S3 client provider
  image.controller.ts    # Upload / delete endpoints
  image.service.ts       # S3 operations, URL generation
  image.config.ts        # S3 configuration (bucket, region, endpoint)
```

**Endpoints:**

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/images` | JWT | Upload image (multipart), returns `{ id, url }` |
| `GET` | `/images/:id` | Public | Redirect / proxy to S3 object |
| `DELETE` | `/images/:id` | JWT | Delete image from storage |

**S3 Configuration (env vars):**

```env
IMAGE_STORAGE_ENDPOINT=http://localhost:9000    # MinIO for dev
IMAGE_STORAGE_BUCKET=wafflebase-images
IMAGE_STORAGE_REGION=us-east-1
IMAGE_STORAGE_ACCESS_KEY=minioadmin
IMAGE_STORAGE_SECRET_KEY=minioadmin
```

**Upload Flow:**

1. Frontend sends `multipart/form-data` with the image file.
2. Backend validates: file type (png, jpg, gif, webp), max size (10 MB).
3. Backend generates a UUID key, uploads to S3 with `PutObject`.
4. Returns `{ id: "<uuid>", url: "/images/<uuid>" }`.

**Dependencies:** `@aws-sdk/client-s3` for S3 operations.

#### Frontend Integration

- Image insert toolbar button opens a file picker.
- On file select → `POST /images` → receive URL → insert image inline.
- DOCX import extracts embedded images → uploads each → inserts URL refs.

#### Development Environment

MinIO is part of the default `docker-compose.yaml` stack:

```yaml
minio:
  image: minio/minio
  ports:
    - "9000:9000"
    - "9001:9001"   # Console
  environment:
    MINIO_ROOT_USER: minioadmin
    MINIO_ROOT_PASSWORD: minioadmin
  command: server /data --console-address ":9001"
  volumes:
    - minio-data:/data
```

### 1.3 Web Font Loading

#### Approach

Use CSS `@font-face` with Google Fonts or self-hosted font files to load
Korean typefaces on demand.

**Font Mapping (DOCX → Web):**

| DOCX Font Name | Web Font | Fallback Chain |
|----------------|----------|----------------|
| 맑은 고딕 | Malgun Gothic | `'Malgun Gothic', 'Noto Sans KR', sans-serif` |
| 바탕 | Batang | `'Batang', 'Noto Serif KR', serif` |
| HY헤드라인M | (no web equivalent) | `'Noto Sans KR', sans-serif` |
| Arial | Arial | `'Arial', sans-serif` |
| Tahoma | Tahoma | `'Tahoma', sans-serif` |

#### Implementation

1. **Font registry** in `packages/docs/src/view/fonts.ts`:
   - Maps font family names to `@font-face` sources.
   - Tracks load status per font (pending → loading → loaded → error).
   - Triggers layout invalidation + re-render when a font finishes loading.

2. **`document.fonts.load()`** — use the browser Font Loading API:
   ```typescript
   async function ensureFont(family: string): Promise<void> {
     if (document.fonts.check(`12px "${family}"`)) return;
     await document.fonts.load(`12px "${family}"`);
     // Trigger re-layout
   }
   ```

3. **measureText cache invalidation** — when a new font loads, clear cached
   measurements for that font family (existing optimization infrastructure in
   `docs-rendering-optimization`).

---

## Phase 2 — DOCX Import

### 2.1 Architecture

```
┌──────────────┐    ArrayBuffer    ┌──────────────┐    Document    ┌──────────────┐
│  File Input   │ ───────────────► │ DocxImporter  │ ────────────► │  DocStore     │
│  (Frontend)   │                  │ (packages/    │               │  (editor)     │
│               │                  │  docs)        │               │               │
└──────────────┘                   └──────────────┘               └──────────────┘
                                         │
                                    POST /images
                                         │
                                         ▼
                                   ┌──────────┐
                                   │  Backend  │
                                   │  (S3)     │
                                   └──────────┘
```

Location: `packages/docs/src/import/docx-importer.ts`

### 2.2 Parsing Pipeline

```
.docx (ZIP) ──► Extract XML + media ──► Parse document.xml ──►
  Map paragraphs to Block[] ──► Map tables to table Block[] ──►
  Upload images ──► Resolve styles ──► Assemble Document
```

**Steps:**

1. **Unzip** the .docx using JSZip.
2. **Parse `word/document.xml`** into an XML DOM.
3. **Parse `word/styles.xml`** to resolve named styles (e.g., `"a3"` table style).
4. **Parse `word/numbering.xml`** if lists exist.
5. **Parse `word/_rels/document.xml.rels`** to map relationship IDs to media files.
6. **Walk `<w:body>`** and convert each element:

| OOXML Element | Docs Block Type |
|---------------|-----------------|
| `<w:p>` | `paragraph` (or `heading` / `list-item` based on style) |
| `<w:tbl>` | `table` (top-level only) |
| `<w:tbl>` inside `<w:tc>` | Flattened to text paragraphs |
| `<w:drawing><wp:inline>` | Image inline within the parent paragraph |
| `<w:sectPr>` | `PageSetup` |
| `<w:headerReference>` | `HeaderFooter` (parse referenced header XML; `<w:p>` and `<w:tbl>` children both convert) |
| `<w:footerReference>` | `HeaderFooter` (parse referenced footer XML; `<w:p>` and `<w:tbl>` children both convert) |

Header and footer parts reuse the same `<w:p>`/`<w:tbl>` walk as the body:
`parseHeaderFooter` dispatches tables through `convertTable` with the
part-scoped image map, so a letterhead layout table in a header imports as
a native `table` block (rendered via the shared `computeLayout`). On export,
`buildHeaderFooterXml` appends a trailing empty `<w:p/>` when the last
header/footer block is a table, since OOXML requires that a header/footer
part not end with a table.

7. **Upload extracted images** to the image service, replace embedded
   references with URLs.

### 2.3 Style Mapping

#### Paragraph Properties (`<w:pPr>`)

| OOXML Property | Docs BlockStyle Field |
|----------------|-----------------------|
| `<w:jc w:val="center">` | `alignment: 'center'` |
| `<w:jc w:val="both">` | `alignment: 'justify'` |
| `<w:spacing w:line="360">` | `lineHeight: 1.5` (line/240 = multiplier) |
| `<w:spacing w:before="120">` | `marginTop` (twips → px: value / 20 × 96/72) |
| `<w:spacing w:after="120">` | `marginBottom` (twips → px) |
| `<w:ind w:firstLine="720">` | `textIndent` (twips → px) |
| `<w:ind w:left="720">` | `marginLeft` (twips → px) |
| `<w:pStyle w:val="1">` | `type: 'heading'`, map style ID to heading level |

#### Run Properties (`<w:rPr>`)

| OOXML Property | Docs InlineStyle Field |
|----------------|------------------------|
| `<w:b/>` | `bold: true` |
| `<w:i/>` | `italic: true` |
| `<w:u w:val="single"/>` | `underline: true` |
| `<w:strike/>` | `strikethrough: true` |
| `<w:sz w:val="24"/>` | `fontSize: 12` (half-points → points) |
| `<w:rFonts w:ascii="Arial"/>` | `fontFamily: 'Arial'` |
| `<w:color w:val="FF0000"/>` | `color: '#FF0000'` |
| `<w:highlight w:val="yellow"/>` | `backgroundColor: '#FFFF00'` |
| `<w:shd w:fill="FFFF00"/>` | `backgroundColor: '#FFFF00'` |
| `<w:vertAlign w:val="superscript"/>` | `superscript: true` |

#### Table Properties

| OOXML Property | Docs Table Field |
|----------------|------------------|
| `<w:tblGrid><w:gridCol w:w="N"/>` | `columnWidths` (normalize to proportions) |
| `<w:gridSpan w:val="2"/>` | `colSpan: 2` |
| `<w:vMerge w:val="restart"/>` | `rowSpan` (count consecutive vMerge cells) |
| `<w:vMerge/>` (continue) | `colSpan: 0` (covered cell) |
| `<w:shd w:fill="E7E6E6"/>` | `style.backgroundColor: '#E7E6E6'` |
| `<w:tcBorders>` | `style.borderTop/Right/Bottom/Left` |

#### Page Setup (`<w:sectPr>`)

| OOXML Property | Docs PageSetup Field |
|----------------|----------------------|
| `<w:pgSz w:w="11906" w:h="16838"/>` | A4 paper (twips → px at 96 DPI) |
| `<w:pgMar w:top="1440" .../>` | `margins` (twips → px) |
| `<w:pgSz w:orient="landscape"/>` | `orientation: 'landscape'` |

**Unit Conversions:**

```
1 inch = 1440 twips = 914400 EMUs = 72 points = 96 CSS px
twips → px: value × 96 / 1440
EMUs → px: value × 96 / 914400
half-points → points: value / 2
```

### 2.4 Image Import Flow

1. Parse `word/_rels/document.xml.rels` to build `rId → filename` map.
2. For each `<w:drawing>` with `<wp:inline>`:
   a. Extract the relationship ID from `<a:blip r:embed="rId5"/>`.
   b. Read the image bytes from the zip (`word/media/image5.png`).
   c. Read `<wp:extent cx="..." cy="..."/>` for dimensions (EMUs → px).
   d. Upload to image service → receive URL.
   e. Create an inline with `text: '\uFFFC'` and `style.image: { src, width, height }`.

### 2.5 Nested Table Handling

When a `<w:tbl>` is encountered inside a `<w:tc>` (table cell), it is
imported as a native nested `table` block:

1. `convertTable` recurses on the inner `<w:tbl>` (see `convertTable` in
   `docx-importer.ts`, which calls itself for `<w:tbl>` cell children).
2. The resulting `table` block is appended to the parent cell's `blocks`,
   so structure, widths, merges, and styling are preserved rather than
   flattened to text.

The grid walk is direct-child only (`findDirectChild`) so a nested grid
never inflates the outer table's column count.

### 2.6 Frontend Integration

Add an "Import" option to the document creation UI:

1. User clicks "Import DOCX" in the document list or editor toolbar.
2. File picker opens, filtered to `.docx`.
3. File is read as `ArrayBuffer` via `FileReader`.
4. `DocxImporter.import(buffer, imageUploader)` is called:
   - `imageUploader: (blob: Blob, filename: string) => Promise<string>` is
     provided by the frontend to abstract the upload API call.
5. Returns a `Document` object.
6. A new document is created via the backend API, and the imported `Document`
   is set as the initial content.

### 2.7 Dependencies

- **JSZip** (`jszip`) — .docx unzipping in the browser.
- No XML parser library needed — use browser-native `DOMParser`.

---

## Phase 3 — DOCX Export

### 3.1 Architecture

```
┌──────────────┐   Document    ┌──────────────┐    Blob     ┌──────────────┐
│  DocStore     │ ────────────► │ DocxExporter  │ ──────────► │  Download    │
│  (editor)     │              │ (packages/    │             │  (browser)   │
│               │              │  docs)        │             │              │
└──────────────┘               └──────────────┘             └──────────────┘
                                     │
                                GET /images/:id
                                     │
                                     ▼
                               ┌──────────┐
                               │  Fetch   │
                               │  images  │
                               └──────────┘
```

Location: `packages/docs/src/export/docx-exporter.ts`

### 3.2 Generation Pipeline

```
Document ──► Build XML strings ──► Fetch images ──►
  Package into ZIP ──► Generate Blob ──► Trigger download
```

**Steps:**

1. **Generate `word/document.xml`** by walking `Document.blocks`:
   - Each `paragraph` block → `<w:p>` with `<w:pPr>` and `<w:r>` runs.
   - Each `table` block → `<w:tbl>` with rows, cells, merged cells.
   - Each image inline → `<w:drawing><wp:inline>` with embedded relationship.
2. **Generate `word/styles.xml`** with default styles and heading definitions.
3. **Generate `word/header1.xml` / `word/footer1.xml`** from `Document.header`
   and `Document.footer`.
4. **Fetch image blobs** from their URLs and add to `word/media/`.
5. **Generate `word/_rels/document.xml.rels`** with image and header/footer
   relationships.
6. **Generate `[Content_Types].xml`** registering all parts.
7. **Package** all parts into a ZIP using JSZip.
8. **Generate Blob** and trigger a browser download via `<a>` click.

### 3.3 Style Mapping (Reverse of Import)

The export maps Docs model properties back to OOXML XML attributes using the
inverse of the tables in Section 2.3 (px → twips, points → half-points, etc.),
with one asymmetry: **import is lenient, export is not**.

The model holds whatever string reached it — DOCX/PPTX import copies
`w:shd/@w:fill` verbatim, the HTML-paste path stores browser-normalized CSS
such as `rgb(255, 0, 0)`, and the issue #728 "reset color" used to store `''`.
Those are not OOXML values, so writing them verbatim yields a file Word
refuses to open, and (for values that reach an attribute unescaped) an
injection sink. Every value-typed attribute is therefore resolved through a
converter that can fail closed:

| Sink | Converter | Failure behavior |
|------|-----------|------------------|
| `<w:color w:val>`, `<w:shd w:fill>` (run + cell) | `toRgbHexColor` (`model/color.ts`, DOCX-facing alias `toDocxHexColor`) | attribute dropped; the run/cell inherits the document default |
| `<w:jc w:val>` | `DOCX_ALIGNMENTS` lookup | falls back to the `left` default (no element emitted) |
| `<w:pStyle w:val="HeadingN">` | `toHeadingStyleId` (integer 1–6) | element dropped; the paragraph exports unstyled |
| `<w:rFonts w:ascii/@w:eastAsia>` | `escapeXmlAttr` | escaped, never dropped (any family name is legal) |

`toRgbHexColor` accepts `#RGB`, `#RRGGBB`, `#RRGGBBAA` and `rgb()`/`rgba()`,
normalizes to the six upper-case hex digits `ST_HexColor` requires, clamps
out-of-gamut channels, and returns `undefined` for everything else. A **fully
transparent** color (`rgba(0,0,0,0)`, `#00000000`) also returns `undefined`:
these attributes carry no alpha, so keeping the triplet would paint an opaque
black block where the screen shows nothing. Partial alpha keeps the triplet and
renders opaque, which is closer to what the user sees than dropping the color.
Because the converter returns only `[0-9A-F]{6}`, these attributes are
injection-proof by construction rather than by escaping.

The same normalizer backs the PPTX exporter's `<a:srgbClr val>` — see
[slides-pptx-export.md](../slides/slides-pptx-export.md).

### 3.4 Image Export Flow

1. For each inline with `style.image`:
   a. Fetch the image from `image.src` URL.
   b. Determine the content type from the response.
   c. Add the image bytes to `word/media/imageN.{ext}`.
   d. Create a relationship entry `rIdN → media/imageN.{ext}`.
   e. Generate `<w:drawing>` XML referencing `rIdN` with dimensions in EMUs.

### 3.5 Frontend Integration

- "Export as DOCX" button in the editor toolbar / file menu.
- Click → `DocxExporter.export(document, imageFetcher)` → Blob → download.
- `imageFetcher: (url: string) => Promise<Blob>` abstracts image fetching.
- A failed image fails the export. `DocxExporter.export`'s fourth argument,
  `onImageError`, opts the caller out of that: the failure is reported there
  and the run is omitted instead. Only the CLI passes one — behind its SSRF
  guard a refused `src` is ordinary — while the browser keeps the throw its
  export UI can report. See
  [`docs-pdf-export.md`](docs-pdf-export.md#surviving-a-failed-image-onimageerror).

### 3.6 Dependencies

- **JSZip** (`jszip`) — packaging the .docx ZIP.
- No additional libraries — XML is generated as template strings.

---

## File Structure

```
packages/docs/src/
  model/
    types.ts                    # + ImageData, image field on InlineStyle
  import/
    docx-importer.ts            # Main importer entry point
    docx-parser.ts              # XML parsing utilities
    docx-style-map.ts           # OOXML → Docs style conversion
    units.ts                    # OOXML unit conversions (twips/EMUs/half-points → px/pt)
  export/
    docx-exporter.ts            # Main exporter entry point
    docx-templates.ts           # XML generation utilities
    docx-style-map.ts           # Docs → OOXML style conversion
  view/
    fonts.ts                    # Font registry and loading

packages/backend/src/
  image/
    image.module.ts
    image.controller.ts
    image.service.ts
    image.config.ts

docker-compose.yaml             # MinIO service (part of the default stack)
```

---

## Risks and Mitigation

| Risk | Mitigation |
|------|------------|
| Complex OOXML edge cases (theme colors, inherited styles) | Start with direct property values; add theme resolution later if needed |
| Large image files slowing import | Validate file size (10 MB limit per image); show progress indicator |
| Korean fonts not available on user's system | Fallback to Noto Sans/Serif KR from Google Fonts |
| Export fidelity — Word may render differently | Test with Word, Google Docs, LibreOffice; focus on structural correctness over pixel-perfect |
| S3 credentials in dev environment | MinIO with default creds for local dev; real S3 for production |
