---
title: image-viewer
target-version: 0.7.0
---

<!-- Make sure to append document link in design README.md after creating the document. -->

# Image Viewer

## Summary

Add **image** as a fifth document type (`"image"`) alongside
`sheet` / `doc` / `slides` / `pdf` / `note`. Like PDF, an image document has
**static content**: the original file is stored as an S3/MinIO blob and the
Postgres `Document` row references it via the existing `fileId` column — there
is **no Yorkie CRDT**. This work is a near-exact mirror of PDF Phase 1
([`pdf.md`](pdf.md)), so most of the backend blob/serving spine is reused
unchanged.

Users drop image files onto the documents list (or pick them from the "New"
menu) and each becomes a first-class document, then open it in a lightweight
`<img>`-based viewer at the existing `/f/:id` route. Two Google-Drive-inspired
touches ship in the same PR: **inline row thumbnails** in the documents list
and **prev/next navigation** through the workspace's images in the viewer.

Comments/sharing (a `image-<id>` Yorkie doc, mirroring PDF Phase 2) and a
full documents-list **gallery/grid view** are explicit Non-Goals here.

### Goals

- Upload image files (`.png` `.jpg`/`.jpeg` `.gif` `.webp`) from the documents
  list — via drag-and-drop and the "New" menu — each created as an `image`
  document. Integrates into the existing multi-file upload queue
  ([`documents-multi-file-upload.md`](documents-multi-file-upload.md)).
- Store the original bytes in the existing `wafflebase-files` blob layer and
  reference them from `Document.fileId` (no new column, no new bucket).
- Serve bytes **gated by the owning document's read policy**, reusing the
  already-type-agnostic `GET /documents/:id/file` endpoint unchanged.
- View in the `/f/:id` route: fit-to-screen, zoom, download; **prev/next**
  across the workspace's images (arrow buttons + keyboard ←/→).
- **Inline thumbnails** in the documents list for `image` rows — client-side
  downscale (no server thumbnail generation), lazily loaded.

### Non-Goals

- **Comments / presence / sharing** for images (the `image-<id>` Yorkie doc,
  mirroring PDF Phase 2). The `image-` key prefix is *reserved* so this stays
  purely additive later, but nothing attaches it in this work.
- **Documents-list gallery/grid view** (a list-wide layout toggle). Deferred —
  tracked as a TODO below. This PR only adds a per-row inline thumbnail.
- Server-side thumbnail generation (sharp) and stored thumbnail blobs.
- Image editing / annotation / crop / rotate. Viewing only.
- SVG, HEIC, AVIF, BMP, TIFF, RAW. Only the four safe raster formats above.
  SVG is excluded on purpose (script-execution surface).
- Public/unauthenticated image URLs — serving stays permission-gated exactly
  like every other document type.

## Proposal Details

### Data model

`Document.fileId` (added for PDF, migration `20260707000000_add_document_file_id`)
is reused as-is — **no new migration**. Only the type enum and validation gates
widen:

- `packages/backend/src/document/document.dto.ts` — extend `DOCUMENT_TYPES`
  to include `'image'`.
- `packages/frontend/src/types/documents.ts` — extend `DocumentType` with
  `"image"`.
- `packages/backend/src/document/document.controller.ts` — `assertFileIdAllowed()`
  currently rejects a `fileId` on any non-`pdf` type. Widen it to allow
  `fileId` on `pdf` **or** `image`.
- `packages/backend/src/yorkie/yorkie-doc-key.ts` — add `image: 'image-'` to
  `YORKIE_DOC_KEY_PREFIXES` and the `yorkieDocKeyPrefix` switch. **Reserved
  only** — nothing attaches an `image-<id>` document in this work; the prefix
  exists so the "unknown type throws" guard never fires for an image document
  and so comments can be added later without a schema change (same posture PDF
  took in its Phase 1).

### Storage & serving — reuse the `file/` module

The `file/` module (`FileService` / `FileController` / `GET /documents/:id/file`)
already stores arbitrary blobs and streams them back with their stored
`ContentType`. Only its allow-list and id pattern need to admit images:

- `packages/backend/src/file/file.service.ts` — extend `MIME_TO_EXT` with the
  four image MIME types:

  ```ts
  const MIME_TO_EXT: Record<string, string> = {
    'application/pdf': 'pdf',
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
  };
  ```

  `upload()` gains a **per-category size cap**: images capped at
  `MAX_IMAGE_UPLOAD_BYTES` (25 MB), PDFs stay at `MAX_PDF_UPLOAD_BYTES`
  (50 MB). `getObject()`/`delete()` are unchanged — already keyed by the
  stored blob id and its stored `ContentType`.
- `packages/backend/src/file/file.config.ts` — `allowedMimeTypes` gains the
  four image types. `maxFileSizeBytes` becomes the **max of both caps** (50 MB)
  so the Multer interceptor admits the largest allowed upload; the tighter
  per-category cap is enforced inside `FileService.upload()`.
- `packages/backend/src/file/file.constants.ts` — `VALID_FILE_ID_PATTERN`
  widens from `\.pdf$` to `\.(pdf|png|jpe?g|gif|webp)$`; add
  `MAX_IMAGE_UPLOAD_BYTES = 25 * 1024 * 1024`.
- `POST /files` (`packages/backend/src/file/file.controller.ts`) — the Multer `fileSize` limit uses the
  new `maxFileSizeBytes` (50 MB). No other change; it stays JWT-gated
  upload-only.
- `GET /documents/:id/file` (`packages/backend/src/document/document-file.controller.ts`) — **unchanged**.
  It already validates `fileId` against `VALID_FILE_ID_PATTERN` (now widened),
  streams the stored `ContentType`, and serves both members and valid
  share-token viewers. Deletion cleanup (delete blob when a document with a
  `fileId` is deleted) is already type-agnostic.

*Per-category cap alternative considered*: a single 50 MB cap for both. Rejected
— 50 MB images are almost always a mistake; the 25 MB image guard costs one
constant and a branch.

### Upload & create flow — extend the existing queue

Images join the existing multi-file upload queue with the **same pipeline as
PDF** (upload original bytes → create document → done; no client-side parse, no
headless `applyContent`):

- `packages/frontend/src/app/documents/upload-kind.ts` — extend `UploadKind`
  with `"image"` and `EXT_TO_KIND` with
  `png/jpg/jpeg/gif/webp → "image"`.
- `packages/frontend/src/api/files.ts` — generalize `uploadPdf(file)` →
  `uploadFile(file)` (same `POST /files` endpoint, same `{ id }` response).
  `pdfFileUrl` stays (or is renamed `fileUrl`) — the serving URL is
  type-agnostic already.
- `packages/frontend/src/app/documents/upload-queue.ts` — `runItem()` routes
  `image` down the **same branch as `pdf`**: `uploadFile(file)` → get `fileId`
  → `createDoc({ title: <name w/o ext>, type: "image", fileId })`. `fileId` is
  persisted on the item immediately so a retry never re-uploads the blob (the
  existing PDF retry-safety, unchanged).
- `packages/frontend/src/app/documents/document-list.tsx` — add an **"Upload
  Image"** item to the "New" menu (picker `accept=".png,.jpg,.jpeg,.gif,.webp"`)
  and a `image` entry to `TYPE_META` / `TYPE_OPTIONS` (icon, color, label) so
  the type filter chip and row badge cover images.
- `packages/frontend/src/app/documents/document-list-utils.ts` —
  `getDocumentPath` returns `/f/:id` for `image` (reuses the file viewer route).

### Viewer — `/f/:id` dispatches by type

`/f/:id` → `FileDetail` currently mounts the PDF stack. It becomes a thin
type-dispatcher:

- `packages/frontend/src/app/files/file-detail.tsx` — after fetching document
  metadata, branch on `doc.type`: `pdf → <PdfCollab>` (unchanged),
  `image → <ImageViewer>`.
- `packages/frontend/src/app/files/image-viewer.tsx` (new) — read-only shell.
  Loads bytes with `fetchWithAuth` → `URL.createObjectURL` → `<img>` (the same
  auth path PDF uses; a direct cross-origin `<img src>` would drop the JWT
  cookie in dev where frontend :5173 ≠ backend :3000). Controls: fit-to-screen
  (default), zoom in/out (buttons + Ctrl/⌘-wheel), download. `revokeObjectURL`
  on unmount. Error state on load failure.
- **Prev/next navigation** — `FileDetail` fetches the current workspace's
  documents (existing list API), filters to `type === "image"`, sorts stably
  (by `title`, then `id`), locates the current id. Left/right chevron buttons
  and keyboard ←/→ navigate to the sibling `/f/:id`; the buttons hide at the
  ends. The fetch is scoped to `doc.workspaceId` and only runs for image
  documents.

### Documents list — inline row thumbnails (D1)

For `type === "image"` rows only, the leading type icon is replaced by a small
**inline thumbnail** (e.g. a fixed ~40×40 box, `object-cover`, rounded):

- `packages/frontend/src/app/documents/` — a small `ImageThumb` component
  fetches bytes via `fetchWithAuth` → object URL, gated behind an
  `IntersectionObserver` so only rows scrolled into view fetch (never the whole
  list at once), and `revokeObjectURL` on unmount. Falls back to the generic
  image icon while loading or on error.
- Client-side downscale only (the box is small; the browser scales the full
  image down). No server thumbnails. **Cost note:** a viewport of large images
  downloads their full bytes; acceptable for a first pass given lazy loading
  and the browser/HTTP `private` cache, and revisited only if it bites.

### Rate limiting (bulk upload)

The global NestJS throttler is `120 req / 60s` per IP
(`packages/backend/src/app.module.ts`). Each image upload spends **2 requests**
(`POST /files` blob + `POST /documents` create) plus a lazy thumbnail
`GET /documents/:id/file` per rendered row, so a large drag-and-drop batch would
trip `429 Too Many Requests` after only a few dozen files. Two mitigations ship
with this feature:

- **`POST /files` throttle raised to `600 / 60s`** (`packages/backend/src/file/file.controller.ts`,
  `@Throttle`), matching the precedent already set for the inline-image routes
  (`packages/backend/src/image/image.controller.ts`). The document-create route stays at the global
  default — the client backoff below absorbs its ceiling.
- **429-aware backoff retry in the upload queue.** `assertOk`/`uploadFile`
  throw a typed `HttpError` carrying `status` + a parsed `Retry-After`; the
  queue auto-retries a 429'd item with capped exponential backoff
  (1→2→4→8→15s, ≤6 attempts, honoring `Retry-After`) instead of failing it.
  The item holds its concurrency slot during backoff, so the whole queue
  self-throttles. Retry is idempotent: `fileId`/`docId` are persisted before
  the failing step and re-read from the live store on each attempt, so a 429 on
  `createDoc` after a successful upload never re-uploads (orphans) the blob.

### TODO (follow-ups, not in this PR)

- **Gallery/grid view (D2)** — a list-wide layout toggle showing large image
  tiles, à la Google Drive's grid. Bigger UI change affecting all document
  types; deferred.
- **Comments / presence / sharing** — attach the reserved `image-<id>` Yorkie
  doc and reuse the shared comments module + presence pattern, mirroring PDF
  Phase 2 slices 1–5.
- **Server thumbnails / more formats (SVG, HEIC, AVIF)** — if list-download
  cost or format demand warrants it.

## Risks and Mitigation

- **Cross-origin auth on `<img>`** — a naive `<img src=BACKEND/documents/:id/file>`
  drops the session cookie across the dev origin boundary. Mitigation: fetch
  bytes with `fetchWithAuth` (credentials) → object URL, both in the viewer and
  the list thumbnail, matching the PDF viewer.
- **List thumbnail download cost** — many large images in view download full
  bytes (no server thumbnail). Mitigation: `IntersectionObserver`-gated lazy
  fetch + `revokeObjectURL`; the `private` cache amortizes repeat views.
  Server-side thumbnails remain an available follow-up.
- **Oversized upload mid-batch** — an image > 25 MB is rejected by the backend.
  Mitigation: the queue surfaces a per-row `error` with the reason; other items
  continue (existing multi-file-upload behavior).
- **Orphaned blobs** — upload-then-create can leak a blob if create fails; same
  posture as PDF/embedded images today. Retry reuses the persisted `fileId`
  rather than re-uploading. Orphan-sweep remains a general follow-up.
- **`fileId` type coupling** — widening `assertFileIdAllowed()` must admit
  `image` **and** `pdf` only; a test asserts a `fileId` on `sheet`/`doc`/`slides`
  is still rejected so the contract can't silently loosen.
- **Untrusted image content** — only the four raster formats are allowed; SVG
  (script surface) is excluded. Bytes are served with their stored image
  `Content-Type` and `X-Content-Type-Options: nosniff` (already set), and
  rendered via `<img>`, which does not execute embedded content.

## Testing

- **`FileService`**: accepts each image MIME and stores it with the right
  extension/`ContentType`; rejects an image > 25 MB; still rejects a non-allowed
  MIME; PDF path unchanged (still 50 MB).
- **Document type / gate**: `CreateDocumentDto` accepts `"image"`;
  `assertFileIdAllowed` accepts `fileId` for `image`+`pdf` and rejects it for
  `sheet`/`doc`/`slides`; `yorkieDocKeyPrefix("image")` returns `image-` and no
  longer throws.
- **Upload queue** (`packages/frontend/src/app/documents/upload-queue.ts`, importers mocked): `png/jpg/jpeg/gif/webp`
  classify to `image`; the `image` item runs the upload→create branch (no
  `applyContent`); `fileId` persisted before create so retry doesn't re-upload;
  unsupported extensions still `skipped`.
- **Frontend routing**: `getDocumentPath({ type: "image" })` → `/f/:id`.
- **Viewer**: `FileDetail` mounts `ImageViewer` for an image doc and `PdfCollab`
  for a pdf doc; prev/next disabled at list ends; keyboard ←/→ navigates.
- **List thumbnail**: `ImageThumb` fetches only after intersection; falls back
  to the icon on error.
- **Manual smoke** (`pnpm dev`): drop a mixed batch (image + xlsx/pdf +
  unsupported) → images land as `image` docs, unsupported skipped; open an
  image, zoom/download, arrow-key through workspace images; list shows inline
  thumbnails that lazy-load on scroll.
