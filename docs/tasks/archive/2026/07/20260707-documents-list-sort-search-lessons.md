# Documents List — Sort, Filter & Last-Modified — Lessons

Captured lessons for `20260707-documents-list-sort-search-todo.md`.

## Design decisions
- **Last-modified read from Yorkie, not Postgres.** Content edits bypass the
  NestJS backend (frontend talks to Yorkie directly), so there is no
  `updatedAt` write path. Rather than add a column + webhook/ping, we read
  `updated_at` from the `AdminService/GetDocuments` `DocumentSummary` the
  backend already fetches for presence. No schema change.
- Favorites deferred: it is the only piece requiring a migration.
- Thumbnails deferred: need render-to-image + blob storage (net-new).

## Lessons (fill in as work lands)
- **Yorkie admin `GetDocuments` JSON is camelCase, not snake_case.** The
  request body uses snake_case (`document_keys`, `include_presences`) and
  works only because connect-go protojson accepts both names on *input*. The
  *response* marshals proto3 canonical camelCase, so `updated_at` arrives as
  `updatedAt`. The existing presence code never exposed this because `key`
  and `presences` are single-word fields. Reading `doc.updated_at` silently
  returned undefined and the "Modified" column fell back to `createdAt` for
  every row — the feature looked wired but did nothing. Caught only in code
  review. Fix reads `updatedAt ?? updated_at` and a regression test
  (`projectSummary`) locks the camelCase field. Confirm field casing against
  the connect-es generated `.d.ts` (`@generated from field ... = N`), not the
  request body.
- **Overriding a service in an e2e stub is a maintenance trap.** Three
  `authenticated`/`user-doc-styles`/`api-key` e2e specs stub
  `YorkieAdminService` with `{ getEditors }`. Adding a new method the
  controller calls (`getSummaries`) 500s the stubbed path until every stub is
  updated. Grep all `overrideProvider(YorkieAdminService)` sites when the
  interface grows.
- **Widening a search predicate can regress UX.** Matching the search box on
  document *type* as well as title floods results on type-name collisions
  (a sheet titled "sheet plan"). With dedicated type chips, keep free-text
  search title-only.

## Thumbnail feasibility (scouted, for the follow-up PR)
- **Blob storage already exists** — `ImageService` (S3/MinIO via
  `@aws-sdk/client-s3`) + workspace-scoped `POST/GET/DELETE
  /api/v1/workspaces/:wid/images` (`packages/backend/src/image/`). Doc/sheet/
  slide images are stored there (URL in Yorkie), not as data URIs. A thumbnail
  is just another blob — storage is **not** net-new.
- **Real previews need the CRDT content** — the list has metadata only, so a
  true thumbnail must be generated **client-side when a doc is already
  attached** (open/edit/save), then uploaded.
- **Slides = turnkey raster path**: reuse `renderThumbnail`/`drawSlide`
  (`packages/slides/src/view/canvas/`) + `canvasToBytes`
  (`packages/slides/src/export/pdf.ts`) → PNG Blob → existing images endpoint.
  **Docs/Sheets = heavier**: must assemble `PaginatedLayout` / `Grid` and
  drive `DocCanvas.render` / `GridCanvas.render`, no existing toBlob helper.
- **One migration required**: add `Document.thumbnailUrl String?`
  (schema has none today; `updatedAt` also absent).
- Recommended follow-up sequencing: (a) grid/card view with **type-colored
  placeholder cards** — low-cost, frontend-only, reuses the type→icon map
  already in `document-list.tsx`; then (b) **slides-only real thumbnails**
  first (placeholder fallback for docs/sheets), since slides is the only
  package with a reusable raster path.
