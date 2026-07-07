---
title: pdf-viewer
target-version: 0.5.0
---

<!-- Make sure to append document link in design README.md after creating the document. -->

# PDF Viewer

## Summary

Add PDF as a fourth document type (`"pdf"`) alongside `sheet` / `doc` /
`slides`. Unlike the three editor types, a PDF document has **static
content**: the original file is stored as an S3/MinIO blob and the
Postgres `Document` row references it — there is **no Yorkie CRDT** in
Phase 1. Users upload a PDF from the documents list and open it in a
pdf.js-based viewer route. Phase 2 layers collaboration (comments +
presence) on top by introducing a `pdf-<id>` Yorkie document that holds
only comment threads, never the PDF bytes.

This document covers Phase 1 (view/store) in full and reserves the
extension points Phase 2 needs.

### Goals

- Upload a PDF from the documents list "New" menu and have it appear as a
  first-class document (title, type filter, last-modified, owner).
- View the PDF in a dedicated route (`/f/:id`) rendered with pdf.js —
  scroll through pages, zoom, download.
- Store the original file in the existing S3/MinIO blob layer; store only
  a reference on the `Document` row.
- Serve the file **gated by the owning document's read policy** — a PDF
  inherits the exact permissions used to read its document (Phase 1: JWT +
  workspace membership, the same check as `GET /documents/:id`).
- Reserve the `pdf-` Yorkie key prefix and a clean data shape so Phase 2
  (comments/presence) is purely additive.

### Non-Goals

- **Phase 1**: comments, presence, annotations/markup, PDF→Docs
  conversion, text extraction, re-upload/replace-version, thumbnails.
- Editing PDF content. PDFs are view-only; editing is out of scope
  entirely (conversion-to-Docs was explicitly declined).
- Public/unauthenticated file URLs. All serving is permission-gated.
- **Anonymous / share-token PDF viewing (Phase 1)**. Today share viewers
  connect directly to Yorkie; a PDF has no Yorkie doc, so a shared-PDF
  path would need its own serving endpoint that accepts a share token.
  There is no existing "member OR valid share token" check to reuse.
  Deferred — it pairs with the Phase 2 collaboration/sharing work.

## Proposal Details

### Data model

Add `"pdf"` as a document type and a nullable blob reference:

- `packages/backend/src/document/document.dto.ts` — extend
  `DOCUMENT_TYPES` to `['sheet', 'doc', 'slides', 'pdf']`.
- `packages/backend/src/yorkie/yorkie-doc-key.ts` — add
  `pdf: 'pdf-'` to `YORKIE_DOC_KEY_PREFIXES` and the `yorkieDocKeyPrefix`
  switch. **Reserved only** — Phase 1 never attaches a `pdf-<id>`
  document; the prefix exists so Phase 2 can attach without a schema
  change. (Reserving it also keeps the "unknown type throws" guard from
  firing if any code path derives a key for a PDF document.)
- `packages/frontend/src/types/documents.ts` — extend `DocumentType`.
- **Prisma migration**: add `fileId String?` to `Document`
  (`packages/backend/prisma/schema.prisma`). Only PDF documents populate
  it; it references the stored blob. Since PDF content is static, this
  column — not Yorkie — is the natural home for the reference.

### Storage layer — new `FileService` / `FileController`

Mirror the existing `image/` module rather than overloading it (keeps
`ImageService` untouched → minimal impact, clean boundary):

- `packages/backend/src/file/file.service.ts` — S3-compatible
  (`@aws-sdk/client-s3`), dedicated bucket `wafflebase-files`, auto-create
  on boot. `upload(buffer, mime, name)` accepts **`application/pdf` only**,
  size cap **50 MB**. Reuses the `image.config.ts` env pattern
  (`FILE_STORAGE_ENDPOINT/BUCKET/REGION/ACCESS_KEY/SECRET_KEY`, dev
  defaults to the same MinIO endpoint).
- `packages/backend/src/file/file.controller.ts`:
  - `POST /files` — JWT, multipart `file`, returns `{ id }`. This runs
    **before** the document exists (upload-then-create flow), so it is
    JWT-gated blob storage only; it does not expose a public GET.
  - No public `GET /files/:id`. Serving is document-scoped (below).
- Blob id validation mirrors `VALID_IMAGE_ID_PATTERN`.

*Alternative considered*: extract a shared S3 blob core and make image/file
thin configs. Deferred — with a single new file type, mirroring is
simpler; revisit if a third blob kind appears.

### Serving — document-scoped, permission-gated

Serving lives on the **document**, not the blob, so it reuses the existing
document read check instead of reimplementing permission logic:

- `GET /documents/:id/file` — runs the same access check as
  `GET /documents/:id` (JWT + `workspaceService.assertMember`), then
  resolves that document's `fileId` and streams the blob from S3. Returns
  404 when the document has no `fileId`.
- Response headers: `Content-Type: application/pdf`,
  `Cache-Control: private, max-age=...` (per-user cache, **not** the
  images' `public, immutable`), optional `ETag`.
- A blob id is never accepted directly from the client for reads — the
  only read path is through a document the caller can already access.
- **Deletion**: when a document with a `fileId` is deleted, delete the
  referenced blob (hook into `DocumentService` delete).

### Upload & create flow

Added to the documents list "New" menu as **"Upload PDF"**. This is a new
path — **not** the existing import pipeline (docx/xlsx/pptx parse the file
into CRDT; PDF stores the original as-is):

```
pick file
  → POST /files            (upload original blob)  → { id }
  → createDocument({ title: <filename w/o .pdf>, type: "pdf", fileId })
  → navigate(/f/:id)
```

Failure ordering: if `createDocument` fails after upload, the blob is
orphaned — same exposure as embedded images today. Acceptable for Phase 1;
an orphan-sweep job is a follow-up.

### Viewer — `/f/:id` → `PdfDetail`

- New route in `packages/frontend/src/App.tsx` (`/f/:id`), sibling to
  `DocsDetail` / `SlidesDetail`.
- `PdfDetail` fetches document metadata, then loads the file via the
  document-scoped serving endpoint and renders pages to canvas using
  **pdf.js (`pdfjs-dist`), dynamically imported**.
- UX: vertical scroll of rendered pages, zoom control, page indicator,
  download button.
- **Bundle**: `pdfjs-dist` is large (hundreds of KB) and its worker is a
  separate chunk. It MUST be lazy-imported inside the viewer route (and
  the worker configured via `import.meta.url`) so it never enters the main
  bundle and does not trip the `FRONTEND_CHUNK_LIMIT_KB` /
  `FRONTEND_CHUNK_COUNT_LIMIT` gate (`harness.config.json`).

### Documents list UI

`packages/frontend/src/app/documents/document-list.tsx`:

- Add a `pdf` entry to `TYPE_META` / `TYPE_OPTIONS` (icon, color, label)
  so the type filter chip and the row type badge cover PDFs.
- `getDocumentPath(type)` → `/f/:id` for `pdf`.
- Add the "Upload PDF" action to the New menu (wired to the flow above).

### Phase 2 reservation (comments / collaboration)

Documented here only to confirm Phase 1 leaves clean seams:

- Introduce a `pdf-<id>` Yorkie document holding **only** comment threads
  and presence (never the PDF bytes — those stay in the blob).
- Reuse the shared frontend comments module (`docs-comments.md`) with
  **page-index + rectangle anchors** instead of text `posRange`.
- Add document-permission-aware presence, matching the existing viewer's
  access gate. No Phase 1 data migration required — the `fileId` column
  and blob storage are unchanged; the Yorkie doc is created lazily on
  first comment.

## Risks and Mitigation

- **Bundle bloat (pdf.js)** — mitigated by dynamic import in the viewer
  route + separate worker chunk; verify against the chunk gate in CI.
- **Orphaned blobs** — upload-then-create can leak a blob on failure;
  same posture as images today. Follow-up: orphan-sweep job.
- **Large files / memory** — 50 MB cap on upload; pdf.js renders pages
  lazily (only visible pages) to bound canvas memory for big documents.
- **Permission drift** — serving reuses the document access guard rather
  than a parallel implementation, so PDF access can't diverge from
  document access. New tests assert a non-member / expired-share request
  is rejected.
- **Untrusted PDF content** — pdf.js runs in its worker sandbox; serve
  with `Content-Type: application/pdf` and avoid inlining into an
  HTML context that could execute embedded scripts.

## Testing

- `FileService`: rejects non-PDF MIME, rejects > 50 MB, stores/returns id.
- Document type: `CreateDocumentDto` accepts `"pdf"`; `yorkieDocKeyPrefix`
  returns `pdf-` (Phase 2 reservation) and no longer throws for it.
- Serving guard: owner/member/valid-share succeed; non-member and
  expired-share are rejected on `GET /documents/:id/file`.
- Frontend: `getDocumentPath("pdf")` → `/f/:id`; viewer smoke render of a
  small fixture PDF.
