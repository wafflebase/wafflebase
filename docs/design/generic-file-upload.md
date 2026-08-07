---
title: generic-file-upload
target-version: 0.6.3
---

<!-- Make sure to append document link in design README.md after creating the document. -->

# Generic File Upload

## Summary

Make the workspace a general-purpose store: **any file, any extension**, the
way Google Drive works. Today the documents list accepts nine extensions
(`.xlsx` `.docx` `.pptx` `.pdf` + five image formats) and everything else is
rejected as "Unsupported file type" — a `.zip`, a `.csv`, a `.mp4`, or a
`Makefile` cannot live in a workspace at all.

The storage and serving spine for this already exists and is already
type-agnostic: `Document.fileId` references a blob in the `wafflebase-files`
bucket, and `GET /documents/:id/file`
(`packages/backend/src/document/document-file.controller.ts`) streams it under
the owning document's read policy. Only three allow-lists stand in the way —
the MIME list in `packages/backend/src/file/file.config.ts`, the extension
regex `VALID_FILE_ID_PATTERN` in
`packages/backend/src/file/file.constants.ts`, and `EXT_TO_KIND` in
`packages/frontend/src/app/documents/upload-kind.ts`.

This design adds an eighth document type, `"file"` — a blob document with **no
dedicated viewer** — and inverts the safety model: storage accepts everything,
while *inline rendering* stays a narrow allow-list. Every unrecognized
extension falls back to `file` instead of being skipped, so the `skipped`
state disappears from the upload queue entirely.

### Goals

- Upload **any** file from the documents list — drag-and-drop and a new
  extension-less "File upload" item in the "New" menu — each becoming a
  first-class `file` document.
- Keep the existing per-type experiences untouched: `.xlsx`/`.docx`/`.pptx`
  still parse into CRDT documents, `.pdf` keeps its comment/presence viewer,
  images keep their thumbnails and prev/next viewer.
- Serve arbitrary bytes **without ever letting uploaded content execute in the
  backend origin**.
- Show a generic file document in the list (icon, size) and at `/f/:id`
  (file card with download), sharable through the existing share-link flow.
- Record `fileSize`/`mimeType` so a workspace storage quota can be added later
  without another migration.

### Non-Goals

- **Workspace storage quota.** Only the columns that make it a `SUM` query
  later are added; no usage table, no limit enforcement, no usage UI.
- **Presigned direct-to-S3 upload.** Uploads keep proxying through
  `POST /files`. The 50 MB cap is deliberately kept at today's value so the
  Multer memory profile does not change.
- **Previews for new types** (video player, text/CSV/markdown viewer, Office
  preview). A `file` document shows a card and a download button, nothing more.
- **Comments / presence on `file` documents.** The `file-` Yorkie key prefix is
  reserved so this stays additive later, but nothing attaches it.
- Server-side virus scanning, archive inspection, or content sniffing.
- Folder upload / directory recursion (already a non-goal of
  [`documents-multi-file-upload.md`](documents-multi-file-upload.md)).

## Proposal Details

### What `Document.type` means

The change only reads as clean once the field is defined, so state it: **`type`
is a routing key — "which viewer/editor opens this document" — not a file
format.** The codebase already treats it that way (`getDocumentPath` in
`packages/frontend/src/app/documents/document-list-utils.ts:81` is a switch to
routes), but it has never been written down, which is why "add a `file` type"
looks like a fallback hack rather than a rule.

Under that definition the blob types line up cleanly:

| type | meaning |
| --- | --- |
| `pdf` | blob with a dedicated viewer (pdf.js + comments) |
| `image` | blob with a dedicated viewer (`<img>` + prev/next) |
| `file` | blob with **no** dedicated viewer |

A file's actual nature lives in one place — `mimeType` — and drives the icon,
the size label, and the download filename. Adding a real viewer later (say a
`video` type for `.mp4`) is then purely additive: existing `.mp4` documents keep
working as `file`, so the migration is optional rather than required.

*Alternative considered — collapse `pdf`/`image` into `file` and dispatch on
`mimeType`.* Conceptually the most honest model, and the surrounding costs are
smaller than they look (the DB migration is one `UPDATE`, reversible from
`mimeType`; `POST /api/v1/.../documents` only accepts `doc`/`slides`/`note`/
`board` so no external contract breaks; the frontend has ~8 `type === "pdf" |
"image"` comparisons). It is rejected on the Yorkie layer:
`yorkieDocKey(type, id)` derives the CRDT document key from `type`, existing PDF
comments live in `pdf-<id>` documents, and **a Yorkie document key is its
identity — it cannot be renamed.** Collapsing the type would strand every
existing PDF comment thread behind an unreachable key. The escapes both defeat
the purpose: computing the key from `mimeType` reintroduces a second de-facto
type discriminator, and special-casing legacy `pdf` rows leaves a permanent
legacy branch.

### Data model

One Prisma migration, two nullable columns on `Document`, no backfill:

| Column | Type | Purpose |
| --- | --- | --- |
| `fileSize` | `Int?` | Size column in the list; the `SUM` target if a quota is added |
| `mimeType` | `String?` | Icon selection, download-filename extension fallback |

Both stay `null` for the CRDT types (`sheet`/`doc`/`slides`/`note`/`board`).
Existing `pdf`/`image` rows keep working unfilled — `downloadFileName`
(`packages/frontend/src/api/download-file.ts`) already recovers the extension
from `fileId` — and are populated going forward as new blobs are uploaded.

The type is widened in the four places that enumerate it:

- `packages/backend/src/document/document.dto.ts` — `DOCUMENT_TYPES` gains `'file'`.
- `packages/frontend/src/types/documents.ts` — `DocumentType` gains `"file"`.
- `packages/backend/src/yorkie/yorkie-doc-key.ts` — `file: 'file-'` in
  `YORKIE_DOC_KEY_PREFIXES` and the switch. **Reserved only**; nothing attaches
  a `file-<id>` document here. Same posture PDF and image took in their Phase 1.
- `packages/frontend/src/app/documents/document-list.tsx` — `TYPE_META` and
  `TYPE_OPTIONS` each gain one entry, which is all the list icon and the filter
  chip need (that map is already documented as the single source).

#### `isBlobBacked` — consolidating a scattered predicate

`type === 'pdf' || type === 'image'` is currently repeated in
`packages/backend/src/document/document-file-id.util.ts:4`,
`packages/frontend/src/app/documents/document-list.tsx:883` (row download
action) and `:1067` (bulk-download selection). A third blob type would make it
three-way in each spot. It becomes one exported predicate per side —
`isBlobBacked(type)` — so a future blob type is a one-line change.

`assertFileIdAllowed` grows past "may this type carry a `fileId`" into a
**type ↔ extension consistency check**, which the serving rules below rely on:

```ts
// document-file-id.util.ts
const FILE_ID_EXT: Record<string, RegExp | null> = {
  pdf: /\.pdf$/i,
  image: /\.(png|jpe?g|gif|webp)$/i,
  file: null, // anything, including no extension
};
```

A `fileId` on a non-blob type is rejected as today; a `fileId` whose extension
contradicts the declared type is now rejected too.

### Upload path

`classifyUploadKind` loses its `null` return:

```ts
// upload-kind.ts
export function classifyUploadKind(fileName: string): UploadKind {
  const dot = fileName.lastIndexOf(".");
  const ext = dot < 0 ? "" : fileName.slice(dot + 1).toLowerCase();
  return EXT_TO_KIND[ext] ?? "file";
}
```

That single change **deletes** `SKIP_REASON`, the `"skipped"` `UploadStatus`,
the "Unsupported" row rendering in
`packages/frontend/src/app/documents/upload-panel.tsx`, and their tests. The
`kind: UploadKind | null` field on `UploadItem` narrows to `UploadKind`. Net
code shrinks.

In `packages/frontend/src/app/documents/upload-queue.ts:364`, the blob branch
widens from `pdf | image` to `pdf | image | file` — the pipeline is already
identical (`uploadFile` → persist `fileId` before creating the document so a
retry never orphans a second blob → `getOrCreateDoc`). Only the fallback title
differs (`"Untitled File"`). Titles keep the existing rule: `stripExt` removes
the extension (`report.zip` → `"report"`) and `downloadFileName` re-appends it
from `fileId` on download, so the user gets `report.zip` back. A double
extension degrades sanely: `archive.tar.gz` → title `archive.tar` → download
`archive.tar.gz`.

The "New" menu gains a **"File upload"** item calling `onImport("")` — an
`accept`-less picker. Drag-and-drop needs no change at all; it never filtered by
extension, it only fed files into a queue that then skipped them.

#### `POST /files` accepts anything

`packages/backend/src/file/file.config.ts` drops `allowedMimeTypes`;
`FileService.upload` drops the MIME check and the `MIME_TO_EXT` lookup as the
source of the stored extension. The 50 MB `MAX_PDF_UPLOAD_BYTES` Multer ceiling
is unchanged and becomes the single cap for every upload, renamed
`MAX_FILE_UPLOAD_BYTES` (the image-specific 25 MB cap is kept — images still
have no reason to be larger).

The stored S3 key is still `<uuid>.<ext>`, but **`ext` now originates from a
client-supplied filename and is untrusted input flowing into an object key**.
It is sanitized rather than validated: lowercase, and accepted only if it
matches `^[a-z0-9]{1,12}$`; otherwise the blob is stored with no extension. The
uuid prefix means the key is never attacker-chosen regardless.
`VALID_FILE_ID_PATTERN` widens accordingly:

```ts
export const VALID_FILE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.[a-z0-9]{1,12})?$/i;
```

`FileService.upload` takes the original filename as a new argument (Multer
already carries it as `file.originalname`; `FileController` simply forwards it)
and returns `{ id, size, mimeType }` so the caller can persist the two new
columns. The client-supplied MIME is stored **as data only** and is never
trusted for a serving decision (next section). It does still select which size
cap applies — `image/*` gets the 25 MB cap, everything else 50 MB — but lying
about it can only widen the cap to 50 MB, which is the ceiling Multer enforces
anyway.

The CLI reaches the same capability through a v1 twin of this route,
`POST /api/v1/workspaces/:wid/files`, which stores the blob and creates the
document in a single call — see [`cli.md`](cli.md) §4 (`files` namespace) and
[`rest-api.md`](rest-api.md) §5.6. It derives the document type from the stored
extension using the same `FILE_ID_EXT` table that validates it, so the browser
and the CLI cannot classify the same file differently.

### Serving & security

Hosting arbitrary user bytes on the backend origin has exactly one serious
failure mode: a file that the browser treats as active content. Today
`document-file.controller.ts:56` echoes the stored `ContentType` with
`Content-Disposition: inline`. If that path ever emitted `text/html`, an
uploaded page would execute **in the backend origin**, with the session cookie
in scope. `X-Content-Type-Options: nosniff` does not help — it prevents
sniffing, not an explicit `text/html`.

Blocking dangerous extensions at upload does not solve this: `.exe` is harmless
at rest, `.html` renamed to `.txt` is not caught, and the blacklist has to be
right forever. The rule is instead placed where it is decidable:

**The response `Content-Type` is derived from the document `type`, never echoed
from storage.**

| document `type` | `Content-Type` | `Content-Disposition` |
| --- | --- | --- |
| `pdf` | `application/pdf` (fixed) | `inline` |
| `image` | stored value **iff** it matches `^image/(png\|jpeg\|gif\|webp)$` | `inline` |
| `image` (stored value fails that test) | `application/octet-stream` | `attachment` |
| `file` | `application/octet-stream` (always) | `attachment; filename*=UTF-8''…` |

So a `.html` upload becomes a `file` document, is served as an opaque
attachment, and downloads instead of rendering. The type↔extension check from
`assertFileIdAllowed` is the first line of defense (you cannot attach an
`.html` blob to a `pdf` document); the derived `Content-Type` is the second, so
neither has to be perfect alone. Both decisions are made server-side from
server-held state.

The `filename*` value is the document title, RFC 5987 percent-encoded with
CR/LF stripped, so a crafted title cannot inject a response header.
`Cache-Control: private, max-age=3600` and `nosniff` are unchanged.

### Viewer & list UI

`packages/frontend/src/app/files/file-detail.tsx` gains a third branch beside
`PdfFileLayout`/`ImageFileLayout`: a `GenericFileLayout` rendering a **file
card** inside the shared `FileShell` — large extension-derived icon, filename,
size, upload time, download button, `ShareDialog`. No Yorkie provider is
mounted, matching `ImageFileLayout`.

Note the existing guard at `file-detail.tsx:164`: a failed document fetch must
not fall through to a layout that attaches a Yorkie document. The new branch
keeps that ordering — resolve `type` first, and let `pdf` remain the explicit
last case rather than the default.

#### Share links: an existing bug this design must not inherit

`packages/frontend/src/app/shared/shared-document.tsx` early-returns for
`resolved.type === "pdf"` (`:719`), then builds `docKey` from a ternary chain
covering `doc`/`slides`/`note`/`board` with **`sheet-${id}` as the fallback**
(`:745`) and renders `SharedDocumentLayout` in the matching `else` (`:808`).
`image` matches no branch, so **an image share link today mounts a
`sheet-<id>` Yorkie document and renders an empty spreadsheet** — reachable,
because `ImageFileLayout` exposes `ShareDialog` (`file-detail.tsx:116`).

A `file` share link would land in the same hole. Rather than adding a second
one-off early return, the two blob-without-CRDT types get one shared branch:
`isBlobBacked(type) && type !== "pdf"` → a `SharedBlobLayout` that renders the
image viewer or the file card with no Yorkie attachment. This fixes image
sharing and makes file sharing correct by construction. It is in scope because
it is a defect in the exact code path this work extends.

### Error handling

- Over-cap files fail **before** the request: the queue marks that row `error`
  with a size reason and the rest of the batch continues. This is new — today
  the queue has no client-side size check at all, so an oversized file is
  uploaded in full and only then rejected by the backend. Adding the check
  matters more now that arbitrary files are accepted, since a 2 GB video would
  otherwise be pushed over the wire before failing.
- Extension-less files (`Makefile`, `LICENSE`) are normal: no stored extension,
  and the download filename is the title as-is.
- The `create-then-populate` window is narrower than for CRDT imports — a blob
  document is complete at create time (`fileId` is set in the same request), so
  there is no headless `applyImportedContent` step and no "document exists but
  is empty" state.

### Testing

- `classifyUploadKind`: unknown extension → `"file"`; no extension → `"file"`;
  known extensions unchanged.
- Extension sanitization: `../../etc`, `php%00`, a 40-char extension, and a
  unicode extension all produce a safe key or no extension.
- Serving headers, one test per document type, asserting `Content-Type` is
  derived and not echoed — including the adversarial case of an `image`
  document whose stored ContentType is `text/html`.
- `assertFileIdAllowed`: rejects `.html` on `pdf`, rejects an image extension
  on `pdf`, accepts anything on `file`, still rejects any `fileId` on `sheet`.
- `isBlobBacked` on every `DocumentType` value.
- Share resolution: `image` and `file` links do not mount a `sheet-<id>`
  document (regression test for the bug above).
- Upload queue: a mixed batch produces no `skipped` rows; retry after a
  simulated `createDocument` failure reuses the stored `fileId`.

### Rollout

A single PR. The migration adds two nullable columns with no backfill and no
data rewrite, so there is no staged deploy and no reverse migration concern —
rolling back the code leaves two unread columns behind.

### Risks and Mitigation

- **Uploaded active content executing in the backend origin** — the reason the
  extension allow-list existed. Mitigated by deriving `Content-Type` from the
  document type and forcing `attachment` for `file`, backed by the
  type↔extension check at document creation. Neither control trusts
  client-supplied MIME.
- **Header injection through the download filename** — mitigated by CR/LF
  stripping plus RFC 5987 encoding of `filename*`.
- **Untrusted extension in an object key** — mitigated by the `^[a-z0-9]{1,12}$`
  sanitizer and the uuid prefix; a rejected extension degrades to no extension
  rather than an error.
- **Unbounded workspace storage growth** — accepted for this version. `fileSize`
  makes the eventual quota a `SUM` over existing rows rather than a backfill.
- **Backend memory under concurrent large uploads** — unchanged from today by
  construction: the cap stays 50 MB and the proxy path is untouched. If sizes
  need to grow, the follow-up is presigned direct-to-S3 upload, which this
  design deliberately leaves as the next step rather than a partial measure.
- **`skipped` removal changes user-visible behavior** — files previously
  refused now silently become documents. This is the point of the feature, but
  it makes a mis-drop (dropping a whole folder's worth of junk) create real
  documents. Mitigated by the upload panel's existing per-row "open document"
  affordance and normal document deletion; no additional confirmation step.
