---
title: docs-docx-import-export
target-version: 0.3.0
---

# DOCX Import / Export

## Summary

Add the ability to import Microsoft Word (.docx) files into the Docs editor
and export documents back to .docx format. This requires three prerequisite
features that the Docs model does not yet support: inline images, image
resource management (S3-compatible storage), and web font loading for Korean
typefaces.

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
- Nested tables — content is flattened to text on import.
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

Add MinIO to `docker-compose.yml`:

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
| `<w:headerReference>` | `HeaderFooter` (parse referenced header XML) |
| `<w:footerReference>` | `HeaderFooter` (parse referenced footer XML) |

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

When a `<w:tbl>` is encountered inside a `<w:tc>` (table cell):

1. Recursively extract all text content from the nested table.
2. Join cell texts with ` | ` separators, rows with newlines.
3. Insert the result as paragraph blocks in the parent cell.

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
inverse of the tables in Section 2.3 (px → twips, points → half-points, etc.).

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
  export/
    docx-exporter.ts            # Main exporter entry point
    docx-builder.ts             # XML generation utilities
    docx-style-map.ts           # Docs → OOXML style conversion
  view/
    fonts.ts                    # Font registry and loading

packages/backend/src/
  image/
    image.module.ts
    image.controller.ts
    image.service.ts
    image.config.ts

docker-compose.yml              # + MinIO service
```

---

## Risks and Mitigation

| Risk | Mitigation |
|------|------------|
| Complex OOXML edge cases (theme colors, inherited styles) | Start with direct property values; add theme resolution later if needed |
| Large image files slowing import | Validate file size (10 MB limit per image); show progress indicator |
| Korean fonts not available on user's system | Fallback to Noto Sans/Serif KR from Google Fonts |
| Nested table content loss | Show a warning toast when nested tables are flattened to text |
| Export fidelity — Word may render differently | Test with Word, Google Docs, LibreOffice; focus on structural correctness over pixel-perfect |
| S3 credentials in dev environment | MinIO with default creds for local dev; real S3 for production |
