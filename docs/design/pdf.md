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
pdf.js-based viewer route. Phase 2 layers collaboration on top by
introducing a `pdf-<id>` Yorkie document that holds only comment threads
and presence — never the PDF bytes — and by making the file-serving
endpoint accept a share token so a shared PDF can be viewed without a
workspace membership. Viewing bytes is open to any valid share token;
**commenting** is gated to editor-role links or workspace members
(client-side, as with every other shared type — see Non-Goals and Slice 3).

This document covers Phase 1 (view/store) in full and Phase 2
(share + comments + presence) as an implementation spec.

### Goals

- Upload a PDF from the documents list "New" menu and have it appear as a
  first-class document (title, type filter, last-modified, owner).
- View the PDF in a dedicated route (`/f/:id`) rendered with pdf.js —
  scroll through pages (Phase 1 MVP; zoom/download are follow-up polish).
- Store the original file in the existing S3/MinIO blob layer; store only
  a reference on the `Document` row.
- Serve the file **gated by the owning document's read policy** — a PDF
  inherits the exact permissions used to read its document (Phase 1: JWT +
  workspace membership, the same check as `GET /documents/:id`).
- Reserve the `pdf-` Yorkie key prefix and a clean data shape so Phase 2
  (comments/presence) is purely additive.

### Non-Goals

- **Phase 1**: comments, presence, share-token viewing (all moved to
  Phase 2 below).
- **All phases**: annotations/markup (highlight/draw on the PDF itself),
  PDF→Docs conversion, text extraction, re-upload/replace-version,
  thumbnails.
- Editing PDF content. PDFs are view-only; editing is out of scope
  entirely (conversion-to-Docs was explicitly declined). Comments anchor
  *over* the PDF; they never mutate the bytes.
- Public/unauthenticated file URLs. All serving is permission-gated —
  either workspace membership or a valid, unexpired share token.
- Server-side per-user write authorization for comments. Consistent with
  the rest of the app (see `sharing.md`), view-only enforcement for share
  viewers is **client-side**; Yorkie has no per-user write auth. A
  determined share viewer could post a comment the UI hides. Accepted as a
  known limitation matching sheets/docs/slides sharing today.

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
  size cap **50 MB**. Reuses the `packages/backend/src/image/image.config.ts` env pattern
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

### Viewer — `/f/:id` → `FileDetail`

- New route in `packages/frontend/src/App.tsx` (`/f/:id`), sibling to
  `DocsDetail` / `SlidesDetail`. The component lives in
  `packages/frontend/src/app/files/file-detail.tsx` (read-only shell) with
  the renderer in `packages/frontend/src/app/files/pdf-viewer.tsx`.
- `FileDetail` auth-gates, fetches document metadata, then mounts
  `PdfViewer`, which loads the file via the document-scoped serving
  endpoint and renders pages to canvas using
  **pdf.js (`pdfjs-dist`), dynamically imported**.
- UX (Phase 1 MVP): vertical scroll of rendered pages at a fixed scale,
  error state on load failure. Zoom control, page indicator, download
  button, and a loading indicator are follow-up polish (not in the MVP).
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

## Phase 2 — Share + comments + presence

Phase 2 attaches the reserved `pdf-<id>` Yorkie document for the first
time (comment threads + presence only; PDF bytes stay in the blob),
closes the one net-new backend gap (share-token file serving), and reuses
the existing shared comments module and frontend presence pattern. No data
migration: the `fileId` column and blob storage are unchanged. The `pdf-<id>`
Yorkie doc is attached on first open of the viewer, with its `comments` map
seeded empty at bootstrap via `initialRoot` (never created lazily — see the
convergence note in Slice 2).

The work splits into five slices; the order below is also the intended PR
sequence.

### Slice 1 — Share-token-aware file serving (only net-new backend work)

`GET /documents/:id/file` is today JWT + `workspaceService.assertMember`.
Extend it to **member OR valid share token** rather than adding a parallel
public endpoint — one access path, no permission drift:

- Make the route reachable without a JWT (optional auth), so anonymous
  share viewers can fetch the bytes.
- Resolution order: if `req.user` is a member of `doc.workspaceId` → serve.
  Else if a `?token=<shareToken>` query param is present →
  `shareLinkService.findByToken(token)`, assert `link.documentId === id`
  and not expired (`findByToken` already throws `GoneException` on
  expiry), then serve. Otherwise `403`.
- **Role is irrelevant for serving** — both `viewer` and `editor` share
  roles may view the PDF. Role only gates comment *writes* (Slice 3).
- Response headers unchanged (`application/pdf`,
  `Cache-Control: private`, `X-Content-Type-Options: nosniff`).

*Alternative considered*: a dedicated public `GET /shared/:token/file`.
Rejected — it forks the permission logic into two implementations that can
diverge; relaxing the existing document-scoped endpoint keeps a single
gate.

### Slice 2 — `pdf-<id>` Yorkie document + comment store

- Wrap the viewer in the collaboration providers. `FileDetail` (today a
  read-only shell with no `DocumentProvider`) mounts
  `<YorkieProvider>` + `<DocumentProvider docKey={`pdf-${id}`}
  initialRoot={{ comments: {} }} initialPresence={…}>`. **`comments: {}`
  is seeded at bootstrap**, not created lazily — concurrent lazy
  `if (!root.comments)` creation lets Yorkie LWW discard one side (the
  same convergence lesson as docs).
- New `packages/frontend/src/app/files/comments/pdf-comment-store.ts`
  — `PdfCommentStore implements CommentStore<PdfRegionAnchor>` over
  `root.comments`, copied from the docs
  `packages/frontend/src/app/docs/comments/yorkie-comment-store.ts`: all
  mutations inside `doc.update()`, `doc.subscribe` → notify, timestamps
  coerced to BigInt (`toYorkieMs`). Because a PDF anchor is plain numbers,
  `copyThread` is a straight deep copy — no live-proxy special-casing like
  the docs `posRange`.
- Add one variant to the shared `CommentAnchor` union in
  `packages/frontend/src/types/comments.ts`:
  `{ kind: 'pdf-region'; pageIndex: number; rect: { x; y; w; h } }`.
  `rect` is **normalized 0–1 page-relative coordinates** so pins are
  independent of zoom/render scale.

### Slice 3 — Comment UI + region pins

- Reuse the shared `CommentSidePanel` / `CommentComposer` /
  `CommentThreadCard` (`packages/frontend/src/components/comments/`) — no
  Yorkie knowledge in that module; it renders over the `CommentStore<A>`.
- New affordance in the viewer: click/drag on a page selects a rectangle
  → opens the composer. Pins/highlights render as **absolutely-positioned
  DOM overlays** over each page's canvas container (normalized `rect` →
  pixels). Clicking a pin opens its thread; hovering highlights it.
- **Orphan handling is nearly a no-op** — pages and rects never move.
  Only `pageIndex >= pageCount` (e.g. a stale anchor) is surfaced as
  orphaned in the panel, reusing the shared `OrphanedCard`.
- Role gating: `readOnly` (share `viewer`) hides/disables the composer —
  read comments only. `editor` role and workspace members may post.
  Enforcement is client-side (see Non-Goals).

### Slice 4 — Presence

- `PdfPresence = { activePage?: number } & User`
  (`packages/frontend/src/types/users.ts`), following the docs frontend
  presence pattern — presence lives in the frontend layer, not in any
  domain store.
- The viewer writes `activePage` (throttled) on scroll via
  `doc.update((_, p) => p.set(...))` and reads peers via
  `doc.getOthersPresences()`. An avatar row shows who else is viewing;
  reuse the domain-agnostic `UserPresence` component with `onSelectPeer`
  scrolling to that peer's page and `getJumpHint` naming it.
- Anonymous share viewers resolve identity via `fetchMeOptional`
  (`"Anonymous"` fallback), exactly as the existing shared routes. No new
  permission surface — presence rides the same connection gate.

### Slice 5 — Shared PDF route + Share button

- `packages/frontend/src/app/shared/shared-document.tsx`: add a `pdf`
  case to the `SharedDocumentInner` type switch → doc key `pdf-${id}`, a
  `SharedFileLayout` that mounts the viewer with
  `fileUrl = pdfFileUrl(id, token)` (share token appended for Slice 1),
  the comments panel, and `readOnly = resolved.role === 'viewer'`.
- No share-link backend change needed: `shareLinkService.create` is
  type-agnostic (checks `doc.authorID` only) and
  `GET /share-links/:token/resolve` already returns `type`, so a PDF
  document produces a working share link today.
- Add a **Share button** to the `FileDetail` header (owner only) that
  opens the existing share dialog.

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
- **(Phase 2) Share-token leak of file bytes** — the relaxed serving
  endpoint must reject expired/mismatched tokens; `findByToken` already
  throws on expiry, and we assert `link.documentId === id` so a token for
  one document can't fetch another's blob. Tests cover expired/mismatched
  cases.
- **(Phase 2) Comment-map convergence** — seed `comments: {}` at
  bootstrap; concurrent lazy creation would let LWW drop one client's
  threads.
- **(Phase 2) Client-side write enforcement** — share `viewer` role only
  hides the composer; a determined viewer can still write to the Yorkie
  doc. Accepted limitation, matching all other shared document types.

## Testing

- `FileService`: rejects non-PDF MIME, rejects > 50 MB, stores/returns id.
- Document type: `CreateDocumentDto` accepts `"pdf"`; `yorkieDocKeyPrefix`
  returns `pdf-` (Phase 2 reservation) and no longer throws for it.
- Serving guard: owner/member/valid-share succeed; non-member and
  expired-share are rejected on `GET /documents/:id/file`.
- Frontend: `getDocumentPath("pdf")` → `/f/:id`; viewer smoke render of a
  small fixture PDF.

### Phase 2

- **Serving gate** (`GET /documents/:id/file`): member serves; valid
  unexpired `?token=` serves; expired token → 410; token whose
  `documentId` ≠ `:id` → rejected; no token + non-member → 403.
- **Comment store**: `YorkieCommentStore` add/reply/edit/delete/resolve
  round-trip over a mem Yorkie doc; two clients adding threads
  concurrently converge (distinct keys merge); `pdf-region` anchor
  (normalized `rect`) round-trips through the CRDT.
- **Region pins**: normalized `rect` → pixel overlay position at a given
  page scale; `pageIndex >= pageCount` renders as orphaned.
- **Role gating**: `readOnly` viewer hides the composer; editor/member
  shows it.
- **Shared route + presence**: `/shared/:token` with a PDF-type link
  mounts the viewer (bytes fetched with the token) and comments panel;
  smoke that a peer's `activePage` presence appears.
