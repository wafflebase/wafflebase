---
title: rest-api
target-version: 0.3.7
---

# REST API and API Key Authentication

## Summary

A versioned REST API (`/api/v1/`) plus workspace-scoped API keys lets
external programs read and write Wafflebase data without a browser
session. Cell data is accessed through a server-side Yorkie client that
attaches to the CRDT document on each request, so API mutations merge
conflict-free with live collaborative edits. The companion CLI design —
which consumes this surface — lives in [cli.md](cli.md).

### Goals

- Let external systems (scripts, integrations, other services) access
  document and cell data without a browser session.
- Provide a workspace-scoped API key that owners can create, list, and
  revoke from the web UI.
- Expose full CRUD for documents, tabs, and cells through a stable,
  versioned REST API.
- Provide read/write access to word-processor (Docs) content via a
  single content endpoint pair.
- Reuse Yorkie CRDT for cell reads and writes so that API mutations
  merge conflict-free with live collaborative edits.

### Non-Goals

- Real-time streaming or WebSocket API (clients use Yorkie directly for
  that).
- Granular per-document or per-cell permission scoping on API keys
  (may be added later).
- Usage metering or per-key quota accounting. (A global request rate
  limit *is* enforced — see §5.6 Rate limiting.)
- Frontend UI for API key management beyond the existing workspace
  settings page.
- MCP server (may be added later as a thin wrapper over the REST API).
- Block-level write or patch on Docs (only whole-document replace via
  content endpoint).

## Proposal Details

### 1. API Key Model

A `ApiKey` Prisma model stores hashed keys scoped to a workspace.

```
ApiKey
  id          String    PK, UUID
  name        String    human-readable label
  prefix      String    first 8 chars of raw key (e.g. "wfb_ab12"), for display
  hashedKey   String    unique, SHA-256 of the full key
  workspaceId String    FK → Workspace (CASCADE delete)
  createdBy   Int       FK → User
  scopes      String[]  default ["read", "write"]
  lastUsedAt  DateTime? updated on each successful auth
  expiresAt   DateTime? optional expiration
  revokedAt   DateTime? soft-revoke timestamp
  createdAt   DateTime  default now()
```

**Key format**: `wfb_` + 32 bytes of `crypto.randomBytes` encoded as
base64url (~47 characters total). The raw key is returned exactly once
at creation time. Only the SHA-256 hash is stored.

### 2. API Key Management Endpoints

All management endpoints require JWT authentication (existing
`JwtAuthGuard`) and workspace owner role.

```
POST   /workspaces/:workspaceId/api-keys       Create key (returns raw key once)
GET    /workspaces/:workspaceId/api-keys       List keys (prefix only, no hash)
DELETE /workspaces/:workspaceId/api-keys/:id   Revoke key (sets revokedAt)
```

### 3. Authentication Flow

`CombinedAuthGuard` inspects the request and delegates:

```
Request arrives
  ├─ Authorization header starts with "Bearer wfb_"
  │   └─ ApiKeyAuthGuard
  │       1. Hash the token with SHA-256
  │       2. Look up by hashedKey
  │       3. Reject if revokedAt is set or expiresAt has passed
  │       4. Update lastUsedAt (fire-and-forget)
  │       5. Set req.user = { id: createdBy, workspaceId, scopes, isApiKey: true }
  │
  └─ Otherwise
      └─ JwtAuthGuard (existing cookie-or-Bearer flow)
```

The v1 API endpoints use `CombinedAuthGuard`. Existing endpoints
continue to use `JwtAuthGuard` only. `JwtStrategy` accepts JWTs from
both the `wafflebase_session` cookie and the
`Authorization: Bearer` header so the CLI can call JWT-guarded
endpoints with its OAuth-issued access token (see [cli.md](cli.md)
"Login flow").

### 4. Yorkie Service

A backend service maintains a single Yorkie `Client` connected to the
Yorkie server. Each REST API call uses a short-lived document
attachment:

```
withDocument(documentId, callback):
  doc = new Document("<prefix>-{documentId}")  // sheet- or doc- prefix
  client.attach(doc, syncMode: manual)
  try:
    result = callback(doc)
  finally:
    client.detach(doc)
  return result
```

This pattern is stateless and safe for concurrent REST calls. Yorkie's
CRDT ensures that writes from the API merge conflict-free with live
user edits.

**Configuration**: `YORKIE_RPC_ADDR` environment variable (default:
`http://localhost:8080`).

**Dependency**: `@yorkie-js/sdk` is in `packages/backend/package.json`,
matching the version used by the frontend (both pin `@yorkie-js/sdk`
0.7.13; the frontend also uses `@yorkie-js/react` 0.7.13).

**Types**: `SpreadsheetDocument`, `Worksheet`, `TabMeta`, and
`Document` (the Docs root) are re-exported from a backend-local Yorkie
types module. Cell-level types (`Cell`, `Sref`, `CellStyle`) are
imported from `@wafflebase/sheets`.

### 5. REST API v1 Endpoints

All endpoints are prefixed with `/api/v1/` and protected by
`CombinedAuthGuard`. For API key auth, the `:workspaceId` parameter
must match the key's bound workspace. For JWT auth, workspace
membership is checked via `WorkspaceService.assertMember()`.

#### 5.1 Documents (metadata)

```
GET    /api/v1/workspaces/:wid/documents              List documents
POST   /api/v1/workspaces/:wid/documents              Create document
GET    /api/v1/workspaces/:wid/documents/:did         Get document metadata
PATCH  /api/v1/workspaces/:wid/documents/:did         Update document (title)
DELETE /api/v1/workspaces/:wid/documents/:did         Delete document
```

These delegate to the existing `DocumentService` for Prisma operations.
`POST` accepts `{ title, type: 'sheet' | 'doc' }` (`type` defaults to
`sheet` for back-compat).

#### 5.2 Tabs (spreadsheets only)

```
GET    /api/v1/workspaces/:wid/documents/:did/tabs        List tabs (id, name, type, order)
POST   /api/v1/workspaces/:wid/documents/:did/tabs        Create a sheet tab ({ name?, type? })
PATCH  /api/v1/workspaces/:wid/documents/:did/tabs/:tid    Rename a tab ({ name })
```

Reads and mutates tab metadata on the Yorkie document via `YorkieService`.
Create/rename reuse the shared `@wafflebase/sheets` tab-name helpers
(`generateTabId` / `getUniqueTabName` / `getNextDefaultSheetName` /
`normalizeTabName`) through `packages/backend/src/yorkie/tab-ops.ts`, so CLI/API
tabs follow the same
naming and uniqueness rules as the editor. Create mirrors the editor
`addSheetTab` mutation (`tabs` + `tabOrder` + empty `sheets[id]`); rename returns
`404` (missing), `400` (blank), `409` (duplicate name).

#### 5.3 Cells (spreadsheets only)

```
GET    /api/v1/.../tabs/:tid/cells                    Get cells (optional ?range=A1:C10)
GET    /api/v1/.../tabs/:tid/cells/:sref              Get single cell
PUT    /api/v1/.../tabs/:tid/cells/:sref              Set single cell
DELETE /api/v1/.../tabs/:tid/cells/:sref              Delete single cell
PATCH  /api/v1/.../tabs/:tid/cells                    Batch update cells
```

**Cell representation** (JSON):

```json
{
  "ref": "A1",
  "value": "Hello",
  "formula": null,
  "style": { "bold": true, "textColor": "#ff0000" }
}
```

**Batch update request** (`PATCH .../cells`):

```json
{
  "cells": {
    "A1": { "value": "Hello" },
    "B2": { "value": "42", "formula": "=A1+1" },
    "C3": null
  }
}
```

Setting a cell to `null` deletes it. All mutations within a single
batch request are applied in one Yorkie `doc.update()` call for
atomicity.

#### 5.4 Docs content (word-processor documents only)

```
GET    /api/v1/workspaces/:wid/documents/:did/content   Read Document JSON
PUT    /api/v1/workspaces/:wid/documents/:did/content   Replace Document JSON
```

`GET` returns the `Document` root from Yorkie (block tree, page setup,
header/footer, inline metadata included as-is). `PUT` replaces the
Yorkie root with the body JSON. Both reject when the document
`type !== 'doc'` with HTTP 409 and a message pointing to the matching
sheets command.

Markdown / text / PDF / DOCX serialization is **not** done by the
backend. The CLI imports `@wafflebase/docs` and runs it locally; this
keeps the backend free of native rendering dependencies. See
[cli.md](cli.md) for the local pipeline.

#### 5.5 Images (workspace-scoped blobs)

```
POST   /api/v1/workspaces/:wid/images         Upload an image (multipart `file`)
GET    /api/v1/workspaces/:wid/images/:imageId  Fetch an image blob
DELETE /api/v1/workspaces/:wid/images/:imageId  Delete an image
```

`ApiV1ImagesController` (`packages/backend/src/api/v1/images.controller.ts`)
is guarded by `CombinedAuthGuard` + `WorkspaceScopeGuard` and delegates
to the S3/MinIO-backed `ImageService`. Uploads accept png/jpeg/gif/webp
up to 10 MB and return `{ id, url }`, where `url` points back at this
workspace-scoped `GET` route. Objects are keyed `{workspaceId}/{imageId}`.
The `GET` route sets `Cache-Control: public, max-age=31536000, immutable`
(`packages/backend/src/api/v1/images.controller.ts`): image ids are
opaque and workspace-scoped, so the blob at a given URL never changes and
is treated as safe to cache. Note this is a `public` policy on a
bearer-token URL — a shared proxy/CDN may cache the object without
re-running `CombinedAuthGuard`/`WorkspaceScopeGuard` on later hits.

#### 5.6 Files (blob documents)

```
POST   /api/v1/workspaces/:wid/files              Upload any file as a document (multipart `file`, optional `title`)
GET    /api/v1/workspaces/:wid/files/:documentId  Download a blob document's bytes
```

`ApiV1FilesController` (`packages/backend/src/api/v1/files.controller.ts`)
is the API-key-capable equivalent of dropping a file on the documents
list, and the only v1 route that creates a blob-backed document. It is
guarded by `CombinedAuthGuard` + `WorkspaceScopeGuard` and throttled at
600/min like the image routes. `POST` additionally requires the `write`
scope from an API-key caller — the guards prove only that the key is
valid and bound to this workspace, so without that check a read-scoped
key could create documents.

Unlike §5.5, which stores a *raw blob* for inline use inside another
document, this creates a first-class `Document` row: `POST` stores the
blob **and** creates the document in one call, deleting the blob if the
row fails, then returns the created document. The browser splits these
into two calls because its upload queue must survive a reload and resume
without orphaning a second blob; a CLI invocation has no resumable state,
so the one-call form is both simpler and safer.

The document `type` is derived server-side from the stored blob id —
`.pdf` → `pdf`, `png|jpg|jpeg|gif|webp` → `image`, everything else →
`file` — by the same extension table that then validates the pairing
(`packages/backend/src/document/document-file-id.util.ts`), so the two cannot disagree. Nothing is
parsed: an uploaded `.xlsx` is stored as bytes, not turned into a
spreadsheet.

`GET` reuses `fileResponseHeaders()`, so it inherits the derived-not-echoed
`Content-Type` rule from [generic-file-upload.md](generic-file-upload.md)
rather than introducing a second serving policy. Caps are unchanged: 50 MB,
or 25 MB for image extensions.

`DELETE /api/v1/workspaces/:wid/documents/:did` deletes the stored blob
alongside the document row, matching the JWT delete.

#### 5.7 Rate limiting

The application registers a global NestJS `ThrottlerGuard` via
`ThrottlerModule.forRoot` (default bucket: 120 requests / 60 s). Selected
routes tighten or relax it with `@Throttle`: the CLI auth endpoints cap
at 10/min and the image endpoints raise to 600/min. This is coarse
request throttling, not per-key usage metering or quotas.

### 6. Module Structure

```
packages/backend/src/
  api-key/
    api-key.module.ts
    api-key.service.ts
    api-key.controller.ts
    api-key.strategy.ts
    api-key-auth.guard.ts
    combined-auth.guard.ts
  yorkie/
    yorkie.module.ts
    yorkie.service.ts
    yorkie.types.ts
  api/
    v1/
      api-v1.module.ts
      documents.controller.ts
      tabs.controller.ts
      cells.controller.ts
      docs-content.controller.ts
      images.controller.ts
      files.controller.ts
      workspace-scope.guard.ts
```

Registered in the root application module: `ApiKeyModule`,
`YorkieModule`, `ApiV1Module`.

### 7. CLI Auth Endpoints

The CLI uses three endpoints in addition to the standard
GitHub OAuth flow. Full design in [cli.md](cli.md) "Login flow"; the
backend surface is:

- **`GET /auth/github?mode=cli&port=<port>`** — extends the existing
  endpoint to carry CLI parameters through OAuth `state`. The backend
  generates a CSRF token (random 32 bytes, TTL 5 minutes, in-memory
  map) and embeds it in the encoded `state`.
- **`GET /auth/github/callback`** — when the decoded state has
  `mode === 'cli'`, generates a short-lived authorization code (random,
  TTL 60 seconds, same in-memory map), redirects to
  `http://127.0.0.1:<port>/callback?code=<auth-code>`. `port` must be
  `1024–65535`; the redirect host is always `127.0.0.1` (hard-coded).
- **`POST /auth/cli/exchange`** — accepts `{ code }`, looks it up,
  validates TTL, deletes it (single-use), and returns
  `{ accessToken, refreshToken }`. No authentication required (the code
  itself is the proof).
- **`POST /auth/refresh`** — body fallback added: if there is no
  `wafflebase_refresh` cookie, the controller reads
  `{ refreshToken }` from the body and returns
  `{ accessToken, refreshToken }` as JSON instead of setting cookies.

Tokens are NOT passed as URL query parameters. The short-lived code is
exchanged server-to-server.

## Risks and Mitigation

| Risk | Mitigation |
|------|------------|
| Yorkie SDK may behave differently in Node.js vs browser | Verify with a spike; the SDK uses gRPC-web which works in Node.js. Fall back to direct gRPC if needed. |
| Attach/detach per request adds latency | Acceptable for v1. A connection pool with LRU eviction can be added later if latency becomes a problem. |
| Concurrent API writes and live user edits | Yorkie CRDT handles conflict-free merging by design. Document this for API consumers. |
| API key leakage | Store only SHA-256 hashes. Show raw key once at creation. Support revocation and optional expiration. |
| `SpreadsheetDocument` / `Document` type duplication (backend) | Keep a backend-local copy. Long-term, move shared types to `@wafflebase/sheets` / `@wafflebase/docs`. |
| `PUT /content` race with live collaborators (lost work) | The CLI marks the `--replace` path `safety: destructive` and forces confirmation. A future iteration may add an optimistic `lastSeq` check. |
| Yorkie key prefix for word-processor docs differs from `doc-<id>` | The frontend convention is the source of truth; the backend service is the only adjustment point if it changes. |
| Open redirect via CLI port parameter | `port` is range-validated; the redirect host is hard-coded to `127.0.0.1`. |
| OAuth state forgery (CSRF) | Backend generates a random 32-byte CSRF token per OAuth request, stores in a 5-minute in-memory map, and validates on callback. |
