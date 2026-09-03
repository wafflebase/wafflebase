# REST API

The Wafflebase REST API lets you read and write spreadsheet, document, presentation, note and blob data programmatically. All endpoints are under `/api/v1/`.

## Authentication

Every `/api/v1/` route (except the image read route, below) is mounted behind `CombinedAuthGuard`, which accepts **two** credentials:

| Credential | How it is detected | Authority |
|------------|--------------------|-----------|
| **API key** | `Authorization: Bearer wfb_...` | The workspace the key was minted for, plus the key's `scopes` |
| **Session cookie** | Anything else — the request falls through to the JWT guard | Workspace membership and document ownership of the signed-in user |

The guard routes on the header: a bearer token starting with `wfb_` goes to the API-key strategy, and everything else — including a request with no `Authorization` header at all — goes to the JWT cookie strategy. So the same endpoints work from a browser session and from a script holding an API key.

### Creating an API Key

1. Go to your workspace settings
2. Navigate to **API Keys**
3. Click **Create API Key** and give it a name
4. Copy the key (it starts with `wfb_`) — it is shown only once

### Using the API Key

Include the key in the `Authorization` header:

```bash
curl -H "Authorization: Bearer wfb_your_key_here" \
  https://api.wafflebase.io/api/v1/workspaces/:wid/documents
```

An API key is bound to one workspace. If the `:workspaceId` in the route is a different workspace, the request fails with `403 API key is not scoped to this workspace`.

### The `write` scope

An API key carries `scopes`, and every mutating v1 route requires the `write` scope. This is enforced surface-wide by `ApiKeyWriteScopeGuard`, not per handler: any request whose method is `POST`, `PUT`, `PATCH` or `DELETE` is refused when the caller is an API key without `write`:

```json
{ "statusCode": 403, "message": "This API key does not have write access" }
```

`GET` requests are never checked. **JWT (cookie) callers are unaffected** — scopes exist only on API keys, and a signed-in user's authority is workspace membership and document ownership.

Mint a key with `scopes: ["read"]` when a script only needs to read; a read-scoped key cannot reach `PUT .../content`, which is a destructive replace of a whole document.

## Base URL

```
https://api.wafflebase.io/api/v1/workspaces/:workspaceId
```

Replace `:workspaceId` with your workspace ID. On a self-hosted deployment, replace the origin too — `https://api.wafflebase.io` is the hosted service and the CLI's default; substitute whatever origin your backend is served from.

## API Surface by Document Type

A workspace holds documents of eight types. `type` is a **viewer-routing key** — which editor or viewer opens the document — not a file format:

| Type | What it is |
|------|------------|
| `sheet` | Spreadsheet (default) |
| `doc` | Word-processor document |
| `slides` | Presentation |
| `note` | Markdown note |
| `board` | Infinite canvas |
| `pdf` | Uploaded PDF blob |
| `image` | Uploaded image blob |
| `file` | Any other uploaded blob |

`POST /documents` accepts only `doc`, `slides`, `note` and `board` as an explicit `type`. **Anything else — including `pdf`, `image`, `file`, a typo, or an omitted field — silently falls back to `sheet`.** The blob types are created by uploading bytes to [`POST /files`](#files-blob-documents) instead; they are not creatable through the document create route.

| Section | Applies to |
|---------|------------|
| [Documents](#documents) | every type |
| [Files](#files-blob-documents) | `pdf` / `image` / `file` |
| [Images](#images) | workspace-scoped image blobs (not documents) |
| [Tabs](#tabs-sheets-only) | `sheet` |
| [Cells](#cells-sheets-only) | `sheet` |
| [Rows and columns](#rows-and-columns-sheets-only) | `sheet` |
| [Worksheet settings](#worksheet-settings-sheets-only) | `sheet` |
| [Worksheet styles](#worksheet-styles-sheets-only) | `sheet` |
| [Column and row dimensions](#column-and-row-dimensions-sheets-only) | `sheet` |
| [Rules](#conditional-formats-and-data-validations-sheets-only) | `sheet` |
| [Charts](#charts-sheets-only) | `sheet` |
| [Filter and pivot](#filter-and-pivot-sheets-only) | `sheet` |
| [Document content](#document-content-docs-slides-and-notes) | `doc` / `slides` / `note` |

### What a wrong document type returns

There is no single answer — it depends on which family you call, and the difference is worth knowing before you write a retry:

| Family | Called against the wrong type |
|--------|-------------------------------|
| Tabs, rows/columns, worksheet settings, styles, dimensions, rules, charts, filter/pivot | `400`, with a message naming the actual type, e.g. `Tabs are only available on sheet documents; "<id>" is a "doc" document.` |
| Cells (`GET`) | **No type check** — the reads are deliberately left open. The read attaches to the `sheet-<id>` Yorkie key, which for a non-sheet document is empty, so there is no worksheet and the request returns `404 Tab not found` |
| Cells (`PUT` / `DELETE` / `PATCH`) | `400`, like the families above: `Cell writes are only available on sheet documents; "<id>" is a "doc" document.` See [Cells](#cells-sheets-only) |
| Document content (`/content`) | `409` with a structured body — the only place `TYPE_MISMATCH` exists |

The `409` body is:

```json
{
  "error": {
    "code": "TYPE_MISMATCH",
    "message": "Use 'sheets cells get' for spreadsheet documents"
  }
}
```

Other common statuses: `404 Document not found` when the document id is not in the workspace, `404 Tab not found` for an unknown `tabId`, `401` for a missing or invalid credential, and `400` from the body validators described per endpoint below.

## Documents

Document CRUD works for every type.

### List Documents

```bash
GET /api/v1/workspaces/:wid/documents
```

```bash
curl -H "Authorization: Bearer wfb_..." \
  https://api.wafflebase.io/api/v1/workspaces/:wid/documents
```

Returns the workspace's document rows. Each row additionally carries an `editors` field when Yorkie reports someone currently editing that document; documents with no active editors omit it.

### Create Document

```bash
POST /api/v1/workspaces/:wid/documents
```

```bash
# Create a sheet (default)
curl -X POST \
  -H "Authorization: Bearer wfb_..." \
  -H "Content-Type: application/json" \
  -d '{"title": "Q1 Report"}' \
  https://api.wafflebase.io/api/v1/workspaces/:wid/documents

# Create a doc
curl -X POST \
  -H "Authorization: Bearer wfb_..." \
  -H "Content-Type: application/json" \
  -d '{"title": "Meeting Notes", "type": "doc"}' \
  https://api.wafflebase.io/api/v1/workspaces/:wid/documents

# Create a slides deck
curl -X POST \
  -H "Authorization: Bearer wfb_..." \
  -H "Content-Type: application/json" \
  -d '{"title": "Launch Deck", "type": "slides"}' \
  https://api.wafflebase.io/api/v1/workspaces/:wid/documents
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | Yes | Document title |
| `type` | string | No | `"doc"`, `"slides"`, `"note"` or `"board"`. Every other value — including an unrecognised one — is stored as `"sheet"` |

The new document is authored by the caller. For an API key, that is the user who created the key.

### Get Document

```bash
GET /api/v1/workspaces/:wid/documents/:did
```

### Update Document

```bash
PATCH /api/v1/workspaces/:wid/documents/:did
```

**Send only the field you mean to change — the whole body reaches the database row.** The handler is declared as `{ title?: string }`, but that is a compile-time TypeScript type. The global validation pipe skips a body whose runtime metatype is a plain object, so no key is stripped and no key is rejected, and the body is passed straight to Prisma's `document.update()` as its `data`.

What that means in practice:

| You send | What happens |
|----------|--------------|
| `title` | Renamed — the intended use |
| `type`, `fileId`, `fileSize`, `mimeType` | **Written.** These are real `Document` columns. `PATCH {"type": "slides"}` on a spreadsheet answers `200` and changes which editor opens the document |
| A key that is not a column Prisma will write | Prisma throws, and the request fails with a **`500`**, not a `400` |
| `updatedAt` | Ignored. The service overwrites it with the current time whenever the body has at least one key |

In particular, **do not read a document row and `PATCH` the whole object back** after changing `title`. A row from [List Documents](#list-documents) can carry an `editors` field, which is not a column and gives you a `500`; a row from either read carries `type`, which would be rewritten.

Anything beyond `title` here is observable behavior rather than a supported feature. Do not build on it.

```bash
curl -X PATCH \
  -H "Authorization: Bearer wfb_..." \
  -H "Content-Type: application/json" \
  -d '{"title": "Q1 Report (Updated)"}' \
  https://api.wafflebase.io/api/v1/workspaces/:wid/documents/:did
```

### Delete Document

```bash
DELETE /api/v1/workspaces/:wid/documents/:did
```

Authorization differs by credential. An **API key** with the `write` scope may delete any document in its workspace — it is a workspace-scoped credential minted by an owner. A **JWT** caller may only delete a document they manage (workspace owner, or the document's author); otherwise the request returns `403 Only the workspace owner or document owner can delete this document`.

If the document is blob-backed, its stored blob is deleted too, best-effort — a failed blob cleanup does not fail the delete.

## Files (blob documents)

Upload any file as a document, and download its bytes back. This is one call that stores the blob **and** creates the document row; if the row fails, the blob is deleted rather than orphaned.

### Upload a file

```bash
POST /api/v1/workspaces/:wid/files
```

Multipart form upload; the bytes go in the `file` field.

```bash
curl -X POST \
  -H "Authorization: Bearer wfb_..." \
  -F "file=@report.zip" \
  https://api.wafflebase.io/api/v1/workspaces/:wid/files
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `file` | multipart file | Yes | The bytes. Missing → `400 No file uploaded` |
| `title` | string | No | Document title, 1–200 characters. An explicit title longer than 200 is a `400` |
| `folderId` | string | No | Target folder; must belong to the same workspace |

**Document type is derived from the stored extension**, never from the client's declared MIME type: `.pdf` → `pdf`, `.png` / `.jpg` / `.jpeg` / `.gif` / `.webp` → `image`, everything else → `file`. Nothing is parsed — an uploaded `.xlsx` is stored as bytes, not converted into a spreadsheet.

**Title defaults to the whole filename, extension included.** A blob document *is* the file, so the extension belongs in the title; it is also the only surviving copy of an extension the storage-key sanitizer rejects (a `.c++` blob is stored under a bare uuid). A filename over 200 characters is truncated with its extension preserved, rather than rejected.

**Size caps**: 50 MB in general, 25 MB when the upload looks like an image — which is keyed on *both* the MIME type and the extension, so declaring `application/octet-stream` does not buy the larger cap for a `.png`.

`title` and `folderId` are both resolved **before** the bytes are stored, so a rejected title or a folder in another workspace costs no upload.

Returns the created document row.

### Download a file

```bash
GET /api/v1/workspaces/:wid/files/:documentId
```

Returns the raw bytes. A document with no stored blob answers `404 Document has no file`.

The response `Content-Type` is **derived from the document type**, never echoed from storage: a `pdf` document is served as `application/pdf` inline, an `image` document inline only if its stored type is `image/png|jpeg|gif|webp`, and everything else — every `file` document included — as `application/octet-stream` with `Content-Disposition: attachment`. The filename in the disposition is the document title with the blob's extension re-appended when the title lacks it.

Also set: `Cache-Control: private, max-age=3600` and `X-Content-Type-Options: nosniff`.

## Images

Workspace-scoped image storage for images embedded in sheets, docs, slides and boards. These are blobs in the workspace's image bucket, not documents.

### Upload Image

```bash
POST /api/v1/workspaces/:wid/images
```

Multipart form upload. The file is sent in the `file` field.

| Constraint | Value |
|------------|-------|
| Max size | 10 MB |
| Allowed types | `image/png`, `image/jpeg`, `image/gif`, `image/webp` |

The MIME type is checked twice: at the multipart filter (`400 Unsupported file type: <mime>`) and again in the image service, which derives the stored extension from the validated MIME rather than the client's filename.

```bash
curl -X POST \
  -H "Authorization: Bearer wfb_..." \
  -F "file=@chart.png" \
  https://api.wafflebase.io/api/v1/workspaces/:wid/images
```

Response:

```json
{ "id": "<imageId>", "url": "/api/v1/workspaces/:wid/images/<imageId>" }
```

### Get Image

```bash
GET /api/v1/workspaces/:wid/images/:imageId
```

This route is served by a **different controller with a different guard** from upload and delete. It mounts the *optional* combined guard, so an anonymous request is not rejected at the door; read access is resolved inside the handler, and it accepts a share-link token:

```bash
# As a workspace member or a workspace-scoped API key
curl -H "Authorization: Bearer wfb_..." \
  https://api.wafflebase.io/api/v1/workspaces/:wid/images/:imageId

# Anonymously, with a share-link token
curl "https://api.wafflebase.io/api/v1/workspaces/:wid/images/:imageId?token=<shareToken>"
```

Access is granted to a workspace-scoped API key, a workspace member (JWT), **or** a valid unexpired `?token=` share link whose document belongs to this workspace. Granularity is deliberately workspace-level: there is no database link from an image blob to the document embedding it, and image ids are unguessable UUIDs. This path exists because an `<img>` request from a shared document carries no CRDT credential — without it, every image in a shared document fails to load.

A refusal is not always the same status, and the difference tells you which credential failed:

| Status | Condition |
|--------|-----------|
| `403 API key is not scoped to this workspace` | An API key minted for a different workspace. It is refused here rather than falling through to the share token |
| `404 Share link not found` | A `?token=` that matches no share link. Raised while resolving the token, so it wins over the generic refusal |
| `410 Share link has expired` | A `?token=` whose link is past its `expiresAt`. Also raised while resolving the token |
| `403 Not allowed to read this image` | Everything else: anonymous with no token, a signed-in non-member, or a valid token whose document belongs to another workspace |

An `imageId` that is not `<uuid>.<png|jpg|jpeg|gif|webp>` is `400 Invalid image id`; an unknown one is `404 Image not found`.

Response headers:

```
Content-Type: <the stored image type>
Cache-Control: private, max-age=31536000, immutable
X-Content-Type-Options: nosniff
```

The `private` is load-bearing — the response is access-gated, so it must not land in a shared cache. `immutable` still lets the viewer's own browser cache it, since image ids are UUIDs that never change content.

### Delete Image

```bash
DELETE /api/v1/workspaces/:wid/images/:imageId
```

Response:

```json
{ "deleted": true }
```

## Tabs (sheets only)

Sheets are organized into one or more **tabs**. These endpoints check the document type first: a non-`sheet` document returns `400 Tabs are only available on sheet documents; "<id>" is a "<type>" document.`

### List Tabs

```bash
GET /api/v1/workspaces/:wid/documents/:did/tabs
```

Response is an array of tab descriptors, in the document's tab order:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Stable tab id |
| `name` | string | Display name (falls back to the id) |
| `type` | string | Tab type (`"sheet"`, `"datasource"`, …; defaults to `"sheet"`) |
| `kind` | string? | Sheet subtype, when the tab carries one |

### Create Tab

```bash
POST /api/v1/workspaces/:wid/documents/:did/tabs
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | No | Requested name. Omitted or blank → the next default `SheetN`. A name already in use is made unique rather than refused |
| `type` | string | No | Only `"sheet"` is supported; any other value is `400 Unsupported tab type "<type>"; only "sheet" is supported.` |

```bash
curl -X POST \
  -H "Authorization: Bearer wfb_..." \
  -H "Content-Type: application/json" \
  -d '{"name": "Q1"}' \
  .../documents/:did/tabs
```

Returns `{ "id", "name", "type" }` — read `name` back, since it may have been uniqued.

### Rename Tab

```bash
PATCH /api/v1/workspaces/:wid/documents/:did/tabs/:tid
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | New name |

Unlike create, rename does **not** unique the name — it reports:

| Status | Condition |
|--------|-----------|
| `404 Tab not found` | No such tab in this document |
| `400 name is required` | Missing or blank after trimming |
| `409 Tab name "<name>" already exists.` | Another tab already uses it |

Returns `{ "id", "name", "type" }`.

## Cells (sheets only)

Cell endpoints operate on a single sheet tab inside a sheet document.

The two halves of this family answer a wrong document id differently, which is worth knowing before you write a retry. Every route checks that the document is in the workspace; only the **writes** additionally check that it is a sheet.

`PUT`, `DELETE` and `PATCH` refuse a non-sheet document before attaching to Yorkie at all, with the same `400` the other sheet-only families use:

```
400 Cell writes are only available on sheet documents; "<id>" is a "doc" document.
```

`GET` has **no** such check. It attaches read-only to the `sheet-<id>` Yorkie key, and for a doc, deck, note or blob document that key holds nothing — the real content lives under `doc-<id>`, `slides-<id>`, `note-<id>`, or in blob storage — so there is no worksheet and the request is `404 Tab not found`. That is the same status an unknown `tabId` on a genuine sheet returns, so a read gives you no way to tell a wrong document id from a wrong tab id. If your ids can be wrong, read the document's `type` from [Get Document](#get-document) first.

The write verbs attach with a **seeded** spreadsheet root, which Yorkie applies when the document is empty. The seed is deliberate and still required: a sheet's Yorkie document does not exist until something attaches to it, so a script writing cells into a freshly created sheet that nobody has opened in the editor yet depends on it. It creates exactly one tab, with the id `tab-1` — so a write to any **other** `tabId` on such a sheet is `404 Tab not found` until the tab exists.

Because the type check runs before the attach, that seed can no longer land on a non-sheet document: a write against a doc, deck, note or blob id is the `400` above, not a phantom `sheet-<id>` document beside the real one.

Each cell in a response has the following shape:

| Field | Type | Description |
|-------|------|-------------|
| `ref` | string | A1-notation reference (e.g. `"A1"`) |
| `value` | string \| null | Stored value |
| `formula` | string \| null | Stored formula, or `null` |
| `style` | object \| null | Stored `CellStyle`, or `null` |

### Get All Cells

```bash
GET /api/v1/workspaces/:wid/documents/:did/tabs/:tid/cells
```

Optional query parameter `?range=A1:C10` filters the result to that rectangle. The filter is applied to the cells that exist — it does not materialize empty cells. **A malformed range is ignored, not rejected**: the full cell list comes back with a `200`.

```bash
# Get all cells
curl -H "Authorization: Bearer wfb_..." \
  .../tabs/:tid/cells

# Get a range
curl -H "Authorization: Bearer wfb_..." \
  .../tabs/:tid/cells?range=A1:C10
```

### Get Single Cell

```bash
GET /api/v1/workspaces/:wid/documents/:did/tabs/:tid/cells/:ref
```

```bash
curl -H "Authorization: Bearer wfb_..." \
  .../tabs/:tid/cells/A1
```

An empty cell is not a `404` — it comes back with `value`, `formula` and `style` all `null`.

### Set Cell Value

```bash
PUT /api/v1/workspaces/:wid/documents/:did/tabs/:tid/cells/:ref
```

| Field | Type | Description |
|-------|------|-------------|
| `value` | string? | Plain value |
| `formula` | string? | Formula (e.g. `"=SUM(A1:A10)"`) |
| `style` | object? | Partial `CellStyle`, validated and shallow-merged onto the cell's existing style |

Every field is optional and each is merged onto what is already stored, so a `PUT` carrying only `style` keeps the cell's value and formula.

`style` accepts exactly these keys; anything else is `400 Unknown style field '<key>'`:

| Key | Type | Meaning |
|-----|------|---------|
| `b` `i` `u` `st` | boolean | Bold, italic, underline, strikethrough |
| `bt` `br` `bb` `bl` | boolean | Border top / right / bottom / left |
| `tc` `bg` `cu` | string | Text color, background color, currency |
| `al` | `left` \| `center` \| `right` | Horizontal alignment |
| `va` | `top` \| `middle` \| `bottom` | Vertical alignment |
| `nf` | `plain` \| `number` \| `currency` \| `percent` \| `date` | Number format |
| `dp` | number | Decimal places |

```bash
# Set a text value
curl -X PUT \
  -H "Authorization: Bearer wfb_..." \
  -H "Content-Type: application/json" \
  -d '{"value": "Revenue"}' \
  .../tabs/:tid/cells/A1

# Set a formula
curl -X PUT \
  -H "Authorization: Bearer wfb_..." \
  -H "Content-Type: application/json" \
  -d '{"formula": "=SUM(A1:A10)"}' \
  .../tabs/:tid/cells/B1

# Set a style only
curl -X PUT \
  -H "Authorization: Bearer wfb_..." \
  -H "Content-Type: application/json" \
  -d '{"style": {"b": true, "al": "center"}}' \
  .../tabs/:tid/cells/A1
```

The response echoes what you sent (`ref`, `value`, `formula`, and `style` when one was supplied), not a re-read of stored state.

### Delete Cell

```bash
DELETE /api/v1/workspaces/:wid/documents/:did/tabs/:tid/cells/:ref
```

Returns `{ "ref": "A1", "deleted": true }`.

### Batch Update

```bash
PATCH /api/v1/workspaces/:wid/documents/:did/tabs/:tid/cells
```

Update multiple cells in a single request.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `cells` | object | **Yes** | Keyed by A1 reference. Each entry takes the same `value` / `formula` / `style` fields as `PUT`; a `null` entry deletes that cell |

`cells` is required in the strong sense: it is not defaulted and not validated, so **omitting it is a `500`, not a `400`** — the handler iterates it before anything checks it exists.

Every supplied `style` is validated **before** any write, so one bad style fails the whole request with a `400` rather than leaving a partial update.

```bash
curl -X PATCH \
  -H "Authorization: Bearer wfb_..." \
  -H "Content-Type: application/json" \
  -d '{
    "cells": {
      "A1": {"value": "Name"},
      "B1": {"value": "Score", "style": {"b": true}},
      "C1": {"formula": "=SUM(B2:B100)"},
      "D1": null
    }
  }' \
  .../tabs/:tid/cells
```

Returns `{ "updated": <number of entries in the body> }`.

## Rows and columns (sheets only)

Structural edits on a sheet tab: clearing a range, and inserting, deleting or moving rows and columns. All four are `POST`.

These run the same engine helpers the editor does, so formulas, merges, range styles, conditional formats, validations, comment anchors and the index-keyed view state (filter range, hidden rows/columns, freeze pane) follow the edit — including other tabs' chart and pivot source ranges.

**Two deliberate differences from the editor:**

- **Cached formula values are cleared, not recalculated.** The calculator is async and needs a live sheet, while this mutation is a synchronous CRDT update. `GET .../cells` therefore reports `value: null` for formula cells on the edited tab until an editor session opens the document and recalculates.
- **A move that would split a merged range is refused with `409`**, naming the merge's anchor. The editor silently does nothing; for an API, silence is indistinguishable from success.

`axis` is `"row"` or `"column"` and **all indices are 1-based**.

### Clear a range

```bash
POST /api/v1/workspaces/:wid/documents/:did/tabs/:tid/clear
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `range` | string | Yes | A1 range (`"A1:C10"`). A bare cell reference (`"A1"`) is accepted as a 1×1 range |

Empties the cells, keeping the structure. The range is normalized before it is bounded, so `"C3:A1"` works. It must be inside the grid (rows 1..1000000, columns 1..18278) and cover at most **1,000,000 cells**; either violation is a `400`.

Returns `{ "cleared": <number of non-empty cells removed> }`.

Note that `clear` is the one structural verb that does **not** refuse pivot-output or datasource tabs — that check applies to insert, delete and move.

### Insert rows or columns

```bash
POST /api/v1/workspaces/:wid/documents/:did/tabs/:tid/insert
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `axis` | `"row"` \| `"column"` | Yes | |
| `index` | integer ≥ 1 | Yes | Insert before this index |
| `count` | integer ≥ 1 | Yes | How many |

Returns `{ axis, index, count }`.

### Delete rows or columns

```bash
POST /api/v1/workspaces/:wid/documents/:did/tabs/:tid/delete
```

Same body as insert. `count` is positive here — the engine's negative-count convention is applied internally, and the response echoes what you sent: `{ axis, index, count }`.

### Move rows or columns

```bash
POST /api/v1/workspaces/:wid/documents/:did/tabs/:tid/move
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `axis` | `"row"` \| `"column"` | Yes | |
| `srcIndex` | integer ≥ 1 | Yes | First index of the block to move |
| `count` | integer ≥ 1 | Yes | Block size |
| `dstIndex` | integer ≥ 1 | Yes | The block lands *before* this index |

A `dstIndex` *strictly inside* the moved block is `400` — moving a block into itself has no meaningful result. The check is `dstIndex > srcIndex && dstIndex < srcIndex + count`, so `dstIndex === srcIndex` is **accepted**: the block lands before its own first index, which is where it already is. That is a `200` and a no-op, not a rejection.

Returns `{ axis, srcIndex, count, dstIndex }`.

### Limits and refusals

| Rule | Behavior |
|------|----------|
| Grid bounds | Indices are 1..1000000 for rows, 1..18278 for columns; `index + count - 1` must also stay inside. `400` |
| `MaxAxisEntries` = 10,000 | The cap on axis entries **one request** may materialize — the same budget the editor's own selection path uses. It is measured per request, not accumulated across them; what accumulates is the grid bound above, which each request is measured against as the axis grows. `400` |
| Insert cost | The growth the request leaves behind, measured against the axis's *current* length: `max(current, index - 1) + count`. Inserting at index 1 of an empty axis costs `count`; inserting at index 50,000 of an empty axis costs ~50,000 and is refused |
| Move cost | **Two separate bounds.** `count` alone must be ≤ 10,000 — a move splices the block out and spreads it back in, so it costs `count` even when the axis already spans it, and this is checked before the document is opened. *And* the axis is back-filled to cover both ends of the move, so `max(current, srcIndex + count - 1, dstIndex - 1)` is checked for growth like an insert. A far-offset move with a tiny `count` — say `srcIndex: 500000, count: 1` on a short axis — is refused for growth even though only one entry moves |
| Delete cost | Bounded by the grid only. A delete materializes nothing, so `{ index: 1, count: 1000000 }` — "delete every row" — stays a single legal call |
| Merge split (move only) | `409`, naming the merged range's anchor |
| Non-sheet tab (insert/delete/move) | `400 Row and column edits are only available on sheet tabs; "<tab>" is a "<type>" tab.` — this is what refuses `datasource` and `lakehouse` tabs, whose grid is re-materialized from their query |
| Pivot-output tab (insert/delete/move) | `400 "<tab>" is a pivot-output tab; its rows and columns are regenerated from the pivot definition.` |

Bodies are validated before the document is opened, and every check that needs the document runs before the first mutation, so a refused request leaves nothing partially applied.

## Worksheet settings (sheets only)

Freeze panes, hidden rows/columns, and merged cells. Each is a `GET`/`PUT` pair on a tab. A `PUT` **replaces** the field.

### Freeze panes

```bash
GET  /api/v1/workspaces/:wid/documents/:did/tabs/:tid/freeze
PUT  /api/v1/workspaces/:wid/documents/:did/tabs/:tid/freeze
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `rows` | integer 0..1000000 | No, default `0` | Frozen row count |
| `cols` | integer 0..18278 | No, default `0` | Frozen column count |

Both default to `0` when absent, so `PUT {}` unfreezes. `GET` returns `{ "rows", "cols" }`.

### Hidden rows and columns

```bash
GET  /api/v1/workspaces/:wid/documents/:did/tabs/:tid/hidden
PUT  /api/v1/workspaces/:wid/documents/:did/tabs/:tid/hidden
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `rows` | integer[] | No, default `[]` | 1-based row indices to hide |
| `columns` | integer[] | No, default `[]` | 1-based column indices to hide |

Indices are **1-based**; a `0` is rejected with a `400` rather than silently dropped. An omitted array is an empty array, so `PUT {}` unhides everything.

`GET` returns `{ "rows": [...], "columns": [...] }`.

### Merged cells

```bash
GET  /api/v1/workspaces/:wid/documents/:did/tabs/:tid/merges
PUT  /api/v1/workspaces/:wid/documents/:did/tabs/:tid/merges
```

Body is `{ "merges": { "<anchorRef>": { "rs": <rowSpan>, "cs": <colSpan> } } }`.

```bash
curl -X PUT \
  -H "Authorization: Bearer wfb_..." \
  -H "Content-Type: application/json" \
  -d '{"merges": {"A1": {"rs": 2, "cs": 3}}}' \
  .../tabs/:tid/merges
```

| Rule | Behavior |
|------|----------|
| Key format | Must round-trip as a plain cell reference (`"A1"`). `"A1:B2"` is refused even though it parses |
| Key bounds | Anchor must be inside the grid |
| `rs` / `cs` | Integers ≥ 1, and the span must not run off the grid from its anchor |
| Span area | `rs * cs` at most **100,000** cells — an unbounded span is not a large merge, it is a document nobody can open again |

`GET` returns `{ "merges": { ... } }`.

## Worksheet styles (sheets only)

### Range styles

```bash
GET  /api/v1/workspaces/:wid/documents/:did/tabs/:tid/range-styles
PUT  /api/v1/workspaces/:wid/documents/:did/tabs/:tid/range-styles
```

Body is `{ "rangeStyles": [ <RangeStylePatch>, ... ] }` — the compact range-style layer, each patch a `{ range, style }` pair. The `PUT` replaces the whole array.

Each patch is run through the sheets engine's own `normalizeRangeStylePatch`, the same validator the editor uses; a patch it rejects is `400 rangeStyles[<i>] is not a valid range style patch`. `GET` re-normalizes what is stored, so stale invalid patches are dropped from the response.

### Sheet style

```bash
GET  /api/v1/workspaces/:wid/documents/:did/tabs/:tid/sheet-style
PUT  /api/v1/workspaces/:wid/documents/:did/tabs/:tid/sheet-style
```

Body is `{ "style": <CellStyle> | null }` using the same `CellStyle` keys as [Set Cell Value](#set-cell-value). An object is shallow-merged onto the stored sheet style; `null` clears it.

**An omitted `style` key is a `400`, not a clear** — since the write merges, treating a missing or misspelled key as "clear" would silently delete a sheet's formatting behind a `200`.

`GET` returns `{ "style": <CellStyle> | null }`.

## Column and row dimensions (sheets only)

Whole-column and whole-row formatting and sizing. Four `GET`/`PUT` pairs, all keyed by the **1-based index rendered as a string** (`"1"` is column A / the first row):

| Routes | Body field | Value type |
|--------|-----------|------------|
| `.../tabs/:tid/column-styles` | `columnStyles` | `CellStyle` or `null` |
| `.../tabs/:tid/row-styles` | `rowStyles` | `CellStyle` or `null` |
| `.../tabs/:tid/column-widths` | `columnWidths` | positive number or `null` |
| `.../tabs/:tid/row-heights` | `rowHeights` | positive number or `null` |

Unlike the other `PUT`s in this family, these **merge per index** rather than replacing the map: a supplied value is merged onto that index, and `null` clears the index. Indices absent from the body are untouched.

```bash
curl -X PUT \
  -H "Authorization: Bearer wfb_..." \
  -H "Content-Type: application/json" \
  -d '{"columnWidths": {"1": 180, "2": null}}' \
  .../tabs/:tid/column-widths
```

A key that is not a 1-based integer index is `400 '<field>' keys must be 1-based integer indices; got "<key>"`. A size that is not a positive finite number is `400 '<field>["<key>"]' must be a positive number or null`.

Each `GET` and each `PUT` returns the full resulting map under the same field name.

## Conditional formats and data validations (sheets only)

```bash
GET  /api/v1/workspaces/:wid/documents/:did/tabs/:tid/conditional-formats
PUT  /api/v1/workspaces/:wid/documents/:did/tabs/:tid/conditional-formats
GET  /api/v1/workspaces/:wid/documents/:did/tabs/:tid/data-validations
PUT  /api/v1/workspaces/:wid/documents/:did/tabs/:tid/data-validations
```

Both take `{ "rules": [ ... ] }` and both **replace** the whole array — omitting a rule deletes it.

Each rule is validated by the sheets engine's own normalizer (`normalizeConditionalFormatRule` / `normalizeDataValidationRule`), the same one the editor uses; a rule it rejects is `400 rules[<i>] is not a valid conditional format rule` (or `... data validation rule`). `GET` maps stored rules back through the same normalizer, so it both drops stale invalid rules and returns plain JSON.

Both return `{ "rules": [ ... ] }`.

## Charts (sheets only)

```bash
GET  /api/v1/workspaces/:wid/documents/:did/tabs/:tid/charts
PUT  /api/v1/workspaces/:wid/documents/:did/tabs/:tid/charts
```

`GET` returns `{ "charts": [ ... ] }` as an array. `PUT` takes `{ "charts": [ ... ] }` and **replaces the whole collection**, keyed by each chart's `id` — omitting a chart deletes it. Duplicate ids are `400 duplicate chart id "<id>"`.

Required per chart:

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | Non-empty; unique within the request |
| `type` | string | One of `bar`, `line`, `area`, `pie`, `scatter` |
| `sourceTabId` | string | Non-empty |
| `sourceRange` | string | Non-empty |
| `anchor` | string | A valid A1 reference |
| `offsetX` `offsetY` | number | Finite |
| `width` `height` | number | Finite and positive |

Optional: `title`, `xAxisColumn`, `colorPalette` (strings), `seriesColumns` (array of strings), `legendPosition` (`top` / `bottom` / `right` / `left` / `none`), `showGridlines` (boolean).

## Filter and pivot (sheets only)

```bash
GET  /api/v1/workspaces/:wid/documents/:did/tabs/:tid/filter
PUT  /api/v1/workspaces/:wid/documents/:did/tabs/:tid/filter
GET  /api/v1/workspaces/:wid/documents/:did/tabs/:tid/pivot
PUT  /api/v1/workspaces/:wid/documents/:did/tabs/:tid/pivot
```

Each is a single object field. `PUT { "filter": null }` clears the filter; `PUT { "pivot": null }` clears the pivot. **Omitting the key entirely is a `400`, not a clear** — a typo'd body must not silently wipe a worksheet's filter.

### Filter body

| Field | Type | Notes |
|-------|------|-------|
| `startRow` `endRow` `startCol` `endCol` | non-negative integers | Required. An inverted range (`endRow < startRow`) is a `400` |
| `columns` | object | Per-column conditions. Structurally checked only — entries are stored as given |
| `hiddenRows` | non-negative integer[] | Optional, defaults to `[]` |

`hiddenRows` is **stored verbatim and never recomputed** from the conditions. Supplying conditions but omitting `hiddenRows` produces an inert filter: the editor shows the dropdowns armed and the conditions set, but every row still visible.

### Pivot body

| Field | Type | Notes |
|-------|------|-------|
| `id` `sourceTabId` `sourceRange` | non-empty strings | Required |
| `rowFields` `columnFields` `valueFields` `filterFields` | arrays | Optional, default `[]`. The **entries are stored as given** — only that each is an array is checked |
| `showTotals` | `{ rows: boolean, columns: boolean }` | Optional; each member defaults to `false` |

Both `GET`s return `{ "filter": ... | null }` / `{ "pivot": ... | null }`; both `PUT`s echo the validated value back.

## Document Content (docs, slides and notes)

Read or replace the full content of a **doc** (word-processor), **slides** (presentation) **or note** (markdown) document. The content is the live Yorkie CRDT document — collaborators in the editor see updates from `PUT` immediately.

Any other document type — a sheet, board, or blob — returns the `409 TYPE_MISMATCH` body shown in [What a wrong document type returns](#what-a-wrong-document-type-returns).

### Get Document Content

```bash
GET /api/v1/workspaces/:wid/documents/:did/content
```

```bash
curl -H "Authorization: Bearer wfb_..." \
  https://api.wafflebase.io/api/v1/workspaces/:wid/documents/:did/content
```

The shape depends on the document's persisted type:

| Type | Response |
|------|----------|
| `doc` | `{ blocks, header?, footer?, pageSetup?, styles? }` — the block tree, header/footer regions, page setup, and the named-style registry |
| `slides` | `{ meta, themes, masters, layouts, slides, guides }` |
| `note` | `{ content }` — the whole markdown document as one string |

### Replace Document Content

```bash
PUT /api/v1/workspaces/:wid/documents/:did/content
```

Destructively replaces the document's Yorkie root with the provided JSON. Concurrent collaborator edits made between the read and the write may be lost — treat this as a destructive, last-write-wins operation. It is also the route most worth minting a read-scoped API key to keep out of reach.

```bash
curl -X PUT \
  -H "Authorization: Bearer wfb_..." \
  -H "Content-Type: application/json" \
  -d @document.json \
  .../documents/:did/content
```

**The body shape is chosen by the body, then checked against the document.** The endpoint sniffs which kind of payload you sent, validates it with the matching validator, and only then compares it to the persisted type:

| Sniffed as | Trigger |
|------------|---------|
| `slides` | A top-level `slides` array |
| `doc` | A top-level `blocks` array (and no `slides` array) |
| `note` | A top-level `content` **string** |

A payload matching none of the three is:

```
400 Invalid content payload: must contain 'blocks' (docs), 'slides' (slides), or 'content' (note)
```

A payload that is well-formed but aimed at the wrong document is:

```
400 Body shape '<shape>' does not match document type '<type>'
```

#### Docs body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `blocks` | array | Yes | Top-level blocks (paragraph, heading, list-item, table, …) |
| `header` | object | No | `{ blocks, marginFromEdge? }`. Omit to clear |
| `footer` | object | No | `{ blocks, marginFromEdge? }`. Omit to clear |
| `pageSetup` | object | No | Paper size, orientation, margins. Omit to clear |
| `styles` | object | No | The named-style registry (`Normal`, `Title`, `Heading 1`, …). **Omitting it — or sending `{}` — deletes the stored registry**, the same destructive-omission contract as `pageSetup`. The document keeps its blocks and comes back with no named styles, behind a `200` |

Omission is destructive for all four optional fields. `GET` the content, edit what comes back, and `PUT` the whole thing — do not assemble a body from `blocks` alone unless you mean to clear the rest.

#### Slides body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `meta` | object | Yes | Must carry non-empty string `title`, `themeId` and `masterId` |
| `themes` | array | Yes | Must be an array; entries are not inspected |
| `masters` | array | Yes | Must be an array; entries are not inspected — a `Master` carries no elements and no text |
| `layouts` | array | Yes | Each layout's `placeholders` and `staticElements`, when present as arrays, are walked as nested elements |
| `slides` | array | Yes | Each slide needs a non-empty string `id` and `layoutId`, an **object `background`**, and **arrays `elements` and `notes`** — all five, not just the two ids |
| `guides` | array | No | Presentation-wide ruler guides. **Omitting it stores `[]`**, deleting every guide on the deck — the same destructive-omission trap as the docs body's optional fields |

#### Note body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `content` | string | Yes | The whole markdown document |

The response echoes the body rather than a re-read of stored state — and on the slides arm it echoes the body *after* validation has filled in the repairs described below, so a `PUT` can answer with fields you did not send.

#### What the endpoint actually checks

The tables above list the top level. Validation goes considerably deeper than that, and the two arms behave differently — docs only rejects, slides both rejects and repairs.

**Docs.** Every block is walked — body, header and footer blocks alike, and recursively into a `table` block's `tableData.rows[].cells[].blocks`:

- Every block needs a non-empty string `id`, a string `type`, and an object `style`.
- Within a style, `alignment` must be one of the engine's block alignments, and the numeric style fields must be finite numbers. `null` is treated as absent throughout.
- A non-table block needs an `inlines` array, each entry an object with a string `text` and an object `style`.
- A `table` block needs `tableData` with `columnWidths` and `rows` arrays, and every cell needs a `blocks` array and an object `style`.
- `header` / `footer` must be objects with a `blocks` array, and a present `marginFromEdge` must be a finite number.

A violation is a `400` naming the offending path, e.g. `Invalid block at blocks[3]: 'style.alignment' must be one of ...`. Nothing is repaired: the docs arm never rewrites your payload.

**Slides.** Elements are walked recursively — a slide's `elements`, a group's `data.children`, and a layout's `placeholders` / `staticElements` — down to a nesting ceiling of **32**, past which the request is a `400`.

- A slide's own element needs a non-empty string `id`, a string `type`, and an object `frame`.
- A *nested* element (group child, layout placeholder) is held to no identity contract — a `PlaceholderSpec` has no `id` at all, and a deck stored before those fields existed must still round-trip. What is checked inside it is the text.
- Text bodies anywhere get the same block-style checks as the docs arm, with one relaxation: `alignment` need only be a **string**, not a member of the allowlist, because slide text is persisted verbatim with no codec to drop an unknown value on read. Slide blocks are also not required to carry an `id`.

Where a field is merely **absent** and every reader of a stored deck would dereference it, the slides arm fills in the empty shape instead of rejecting. That applies to an element's `data`, a text body's `blocks`, a block's `style` and `inlines`, an inline's `style`, a table's `columnWidths` / `rows` and each row's `cells` and each cell's `body` / `style`, a chart's `categories` / `series`, and a group's `children`. A field of the **wrong type** — an array where an object belongs, a non-array `rows` — is still a `400`.

For both arms the practical advice is unchanged: **`GET` the content first and edit what comes back.** The nested block, element, theme, master and layout shapes are defined by the `@wafflebase/docs` and `@wafflebase/slides` engines, and a round-trip is the only reliable way to see the exact structure. Entries inside `themes` and `masters` in particular are stored with no inspection at all.

## Rate limits

The global bucket is **120 requests per minute**. Three v1 controllers raise it to **600 per minute** because a scripted loop bursts past the default:

- `POST` / `DELETE /api/v1/workspaces/:wid/images`
- `GET /api/v1/workspaces/:wid/images/:imageId`
- `POST` / `GET /api/v1/workspaces/:wid/files`

Everything else on `/api/v1/` uses the global bucket.

## Shapes this page does not spell out

Some request and response bodies are defined by the spreadsheet, docs and slides engines rather than by the API layer, and the controllers validate them by handing the payload to an engine normalizer. Those are documented here by their contract — what is required, what is rejected — rather than field by field:

- `RangeStylePatch`, `ConditionalFormatRule` and `DataValidationRule` — validated by the engine normalizers; a `GET` returns exactly what the normalizer accepts, so read before you write.
- `filter.columns` entries and the four pivot field arrays — the controller checks only that they are an object / arrays. Their entries are stored as given.
- Docs blocks, and slides elements, themes, masters and layouts — validated only at the levels listed under [Replace Document Content](#replace-document-content).

In every case, a `GET` on the same endpoint is the authoritative description of the shape the matching `PUT` accepts.
