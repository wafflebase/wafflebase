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

The v1 API endpoints use `CombinedAuthGuard`. Neither it nor
`WorkspaceScopeGuard` reads `scopes` — the guards prove the key is valid and
bound to the workspace, nothing more — so every v1 controller also mounts
**`ApiKeyWriteScopeGuard`**
(`packages/backend/src/api/v1/api-key-write-scope.guard.ts`), which refuses an
API-key caller without the `write` scope on any `POST` / `PUT` / `PATCH` /
`DELETE`. A key minted with `scopes: ['read']` gets a `403` from every
mutating v1 route.

It is one guard keyed on the HTTP method rather than a check written per
handler, because the per-handler form is an absence waiting to happen: it was
present on `documents.delete` and `files.upload` and missing from the other
seven mutating routes, which made the surface *read* as covered while
`PUT …/content` — a destructive replace of a document's whole content — was
open to a read-only credential. A new mutating route is gated the moment it
is added to a controller that mounts the guard. JWT callers are unaffected:
their authority is workspace membership and document ownership, resolved by
the per-handler checks.

Existing endpoints continue to use `JwtAuthGuard` only. `JwtStrategy` accepts JWTs from
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
Yorkie root with the body JSON. Both reject a spreadsheet document with
HTTP 409 and a message pointing to the matching sheets command (the same
routes also serve `slides` and `note` documents, dispatching on the
persisted type).

**`PUT` validation contract.** The writers dereference much of the payload
unconditionally, so a malformed body would otherwise surface as an HTTP 500
from inside Yorkie *after* a partial write. `PUT` therefore validates the body
up front and answers `400` with the offending path (`blocks[3].inlines[0]`,
`slides[1].elements[2].data`, …) on the first problem it finds. Beyond the
structural checks (`blocks` / `inlines` / `tableData.rows[].cells[].blocks`
must be arrays; a block needs a non-empty `id`, a `type` and a `style` object;
an inline needs a string `text` and a `style` object; a table cell needs a
`style` object) it validates the *values* a block style carries:

- `style.alignment`, when present, must be one of `left`, `center`, `right`,
  `justify`.
- `style.lineHeight` / `marginTop` / `marginBottom` / `textIndent` /
  `marginLeft`, when present, must be **finite numbers** — not numeric
  strings. `null` is treated as absent everywhere: it is how JSON spells "no
  value", and the Tree codec already skips it, so it is a field the writer
  drops rather than a `400`.
- `header` / `footer`, when present, must be objects with a `blocks` array
  (walked with the same block validator) and a finite `marginFromEdge`.
- On a slides body the same block-style value checks are applied to the docs
  `Block`s wherever a deck stores them: text elements, shape text, table-cell
  bodies, group children, `slides[].notes`, and
  `layouts[].placeholders` / `layouts[].staticElements`. (`masters[]` needs no
  walk — a `Master` is `{ id, themeId, background, placeholderStyles }` and
  holds no elements and no `Block`s.) They are the same shape reaching the
  same layout engine and the same exporters.
- Two checks are deliberately *relaxed* on that slides walk, because slide
  text bodies are stored **and read back** verbatim as JSON with no attribute
  codec to normalize them: the structural block checks (`id`, a present
  `style`) are not applied, and `style.alignment` need only be a
  string rather than one of the four allowlisted values. Otherwise a
  `GET` → edit → `PUT` round-trip of an older deck would `400` on what the
  reader itself just handed back. An alignment the exporters do not know is
  dropped at their own closed `Map` lookups. For the same reason, elements
  *nested* inside another one (group children, layout placeholders — a
  `PlaceholderSpec` has no `id` at all) are not held to the `id` / `type` /
  `frame` contract that a slide's own `elements` are; only their text bodies
  are walked.
- `inlines` is the exception to that relaxation, because the *shared* docs
  layout engine cannot survive it missing: `resolveBlockInlines` calls
  `block.inlines.map`, `measureSegments` reads `inline.style.image`,
  `resolveColorAtPosition` reads `inline.style.color`, and the slides PDF/PPTX
  font sweep walks both — so a stored block without `inlines`, or an inline
  without `style`, is a `TypeError` for **every viewer of that deck**, not just
  the caller who wrote it. Rejecting an absent value would 400 the very
  round-trip the relaxation exists to protect, so instead the walk *fills the
  empty shape in*: a missing `inlines` becomes `[]` and a missing inline
  `style` becomes `{}` — semantically identical to the value that was missing,
  and exactly what the readers would otherwise have to assume. The repair
  happens before the write and the endpoint echoes the repaired body, so what
  the caller sees is what is stored. A value that is *present but wrong* is
  still a 400: `inlines` must be an array, each entry an object with a string
  `text`, and a present `style` must be an object.
- The same repair covers every other field a stored deck's readers dereference
  unconditionally. Nothing on read repairs them — `migrateElement` touches
  shapes only — so each absent value becomes its empty shape before the write:
  - a text body's `blocks` → `[]` (`body.blocks.map` in the slides text
    renderer);
  - a block's `style` → `{}` (`ALGN.get(block.style.alignment)` in the PPTX
    exporter);
  - an element's whole `data` → the empty shape its **own type** demands, for
    every type rather than just text, because `element.data.effects?.shadow` in
    the element renderer runs for all of them: `{ blocks: [] }` for a text
    element (whose `data` *is* its `TextBody`, read as `el.data.blocks` by
    `isElementEmpty`), `{ rows: [], columnWidths: [] }` for a table
    (`data.columnWidths.length` in `drawTable`, `data.rows` in the height
    scaler and the PDF exporter), `{ children: [] }` for a group
    (`data.children` in `flattenElements`), `{ categories: [], series: [] }`
    for a chart (`data.series` / `data.categories` in `drawChart`), `{}`
    otherwise;
  - inside a chart: an absent `categories` / `series` → `[]`;
  - inside a table: an absent `columnWidths` / `rows` / `row.cells` → `[]`, a
    `null` row → an empty row, a `null` cell → an empty cell, and a cell's
    absent `style` → `{}` and `body` → `{ blocks: [] }`. The cell repair covers
    `style` as well as `body` because `paintCellFills` reads `cell.style.fill`
    and `paddingOf` reads `cell.style.padding` *before* the body is painted,
    and a `null` cell is repaired rather than skipped because the PDF
    exporter's `for (const cell of row.cells) bodies.push(cell.body)` does not
    tolerate one even though the canvas renderer does.

  Where the empty shape cannot be written back — an array is `typeof 'object'`,
  so a repair on one is an expando that JSON serialization drops — the value is
  rejected with a `400` instead. That rejection is applied at **every** entry
  point that would otherwise repair in place: an element's `data`, a text body
  (a shape's `data.text`, a table cell's `body`), and a docs table cell nested
  in a slide text body. A present-but-wrong structural value (`rows`,
  `columnWidths`, `children`, `series`, `cells` that is not an array; a row or
  cell that is a primitive) is likewise a `400` rather than a silent skip.

  The scope of the guarantee is exactly the list above: a deck stored through
  this endpoint cannot be *missing* a field the shared renderers, layout engine
  or exporters dereference without a guard. It is **not** a full model
  validation — the values inside a repaired collection (a chart series entry, a
  `row.height`, an image `src`) are stored as given, so a deck can still render
  wrongly; it cannot render fatally.

- The element walk is depth-bounded (`MAX_ELEMENT_DEPTH`, 32). Groups nest a
  handful of levels in any real deck, but the walk recurses through
  `data.children` against a 25 MB body limit, which is enough for a compact
  payload to exhaust the stack on an authenticated endpoint.

`GET` → edit → `PUT` stays lossless for docs bodies: the read side of the
Tree codec (`@wafflebase/docs` `model/crdt-attrs.ts`) drops exactly the values
the validator rejects, so a legacy document holding an unknown alignment or a
`NaN` margin is returned already normalized to the block defaults.

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
      api-key-write-scope.guard.ts
```

Registered in the root application module: `ApiKeyModule`,
`YorkieModule`, `ApiV1Module`.

### 7. CLI Auth Endpoints

The CLI uses three endpoints in addition to the standard
GitHub OAuth flow. Full design in [cli.md](cli.md) "Login flow"; the
backend surface is:

- **`GET /auth/github?mode=cli&port=<port>&nonce=<hex>`** — extends the
  existing endpoint to carry CLI parameters through OAuth `state`. It is
  unauthenticated and takes the loopback port off the query string, so
  it is answered first with a **confirmation page**
  (`CliLoginConfirmMiddleware`, `X-Frame-Options: DENY`): its Continue
  link carries a one-time secret that also went out as an httpOnly
  `__Host-wafflebase_cli_confirm` cookie (`__Host-` so a sibling
  subdomain cannot write one of its own; unprefixed only outside
  production, where `Secure` is unavailable), and only a matching pair
  proceeds to GitHub. Without that click, a page the victim visits could navigate
  them here and have the backend mint a code **for the victim**
  addressed at a port the attacker chose; the loopback nonce cannot
  cover that, because the attacker picks the nonce.

  Once confirmed, the backend generates a state token (random 32 bytes,
  TTL 5 minutes, in-memory map) and forwards it to GitHub as `state`;
  `mode`, `port` and `nonce` are stored against it, never put in the URL.
  `nonce` is the CLI's per-attempt secret and is accepted only as
  `[0-9a-f]{32,128}`, so nothing that could smuggle another query
  parameter into the loopback redirect gets through. It is optional:
  omitted (or malformed), the login still completes, but with no
  binding for the CLI to verify.
- **`GET /auth/github/callback`** — requires a `state` on **every**
  path; a callback without one is never a sign-in. It is refused with a
  redirect to `FRONTEND_URL/login?error=oauth_state`, not a 400: losing
  the state needs no attacker (the cookie lives ten minutes, and a
  second login tab overwrites the first tab's), so the refusal has to
  land the user on a page they can retry from rather than as backend
  JSON on the backend's own origin. Refusing and returning them
  somewhere useful are independent — no session is issued either way.
  See [backend.md](backend.md) for the full callback contract. A browser
  login carries `web.<sha256(secret)>`, whose secret lives in a
  short-lived httpOnly `__Host-wafflebase_oauth_state` cookie (double
  submit,
  compared in constant time and cleared on use) — no server-side map, so
  it survives restarts and spans replicas, which is what an in-memory
  store could not do. Otherwise the state is a CLI token: when the
  consumed state has
  `mode === 'cli'`, generates a short-lived authorization code (random,
  TTL 60 seconds, same in-memory map), redirects to
  `http://127.0.0.1:<port>/callback?code=<auth-code>&state=<nonce>`.
  `port` must be `1024–65535`; the redirect host is always `127.0.0.1`
  (hard-coded). The `state` fragment is the CLI's own nonce echoed back
  and is omitted when the authorization carried none.

  Echoing the nonce is a **backend contract**: the CLI accepts a `code`
  only from a callback carrying it, so a CLI at this version or later
  needs a backend at this version or later. Against an older backend
  the CLI does not hang silently — it reports the refusal ("the
  redirect carried no `state` … the server is likely older than this
  CLI") on stderr as it happens and repeats it in the timeout error.
- **`POST /auth/cli/exchange`** — accepts `{ code, verifier }`, looks the
  code up, validates TTL, deletes it (single-use on *any* attempt),
  checks `sha256(verifier)` against the challenge registered when the
  login started, and returns `{ accessToken, refreshToken }`.

  The `verifier` is required, and it is what keeps the code from being a
  bearer credential: the code reaches the CLI as a plaintext query string
  on a `http://127.0.0.1:<port>/callback` navigation, at a port taken off
  the start URL, so anything that observes that hop would otherwise hold
  a full unauthenticated path to access **and** refresh JWTs. The
  verifier is 32 random bytes the CLI keeps in memory and sends only in
  this POST body; only its SHA-256 travels through the browser
  (`?challenge=`, PKCE S256). A CLI login that registered no challenge is
  refused at the callback rather than issued a weaker code, so the pair
  is a **backend + CLI contract** in both directions.
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
| OAuth state forgery (CSRF) | Backend generates a random 32-byte state token per OAuth request, stores it in a 5-minute in-memory map, and consumes it on callback (single-use; an unknown or expired token is a 400, never a fall-through to the web flow). |
| Login CSRF on the CLI loopback callback | The port space is small enough for a page the user visits to scan, so a `code` alone is not trusted: the CLI mints a per-attempt nonce, the backend echoes it as the loopback `state`, and the CLI compares it in constant time. A callback without it is refused, reported, and never ends the wait — the genuine redirect can still arrive. |
| Login CSRF on the **web** callback | Browser logins carry a double-submit `state`: the secret is a short-lived httpOnly `__Host-wafflebase_oauth_state` cookie (the prefix is what stops a sibling subdomain from tossing a cookie of its own choosing and restoring the attack; unprefixed only outside production, where `Secure` is unavailable), its SHA-256 goes to GitHub as `state`, and the callback accepts only a matching pair (constant-time, single-use). The hash — not the secret — travels through referrers and logs, so a leaked `state` cannot be replayed without the cookie. Being a cookie rather than a store, it survives restarts and spans replicas. A callback with no `state`, a mismatched one, or a repeated `?state=` issues no session and returns the browser to `FRONTEND_URL/login?error=oauth_state` — losing the cookie needs no attacker (it lives ten minutes, and a second login tab overwrites the first tab's), so the refusal has to land on a page the user can retry from rather than as backend JSON on the backend's own origin. |
| CSRF into a CLI login (`?mode=cli&port=…`) | The endpoint is unauthenticated and the port comes off the query string, so a bare navigation is not enough: the backend answers with a confirmation page and only its Continue link — a one-time secret paired with an httpOnly cookie, framing blocked by `X-Frame-Options: DENY` — starts the OAuth redirect. `GitHubAuthGuard` mints CLI state only for a request the middleware confirmed, so an unwired gate degrades to a browser login instead of failing open. |
| A login another *site* navigated the browser into | `GitHubAuthGuard` refuses `Sec-Fetch-Site: cross-site` with a `400` before any state is minted; `none` (the CLI's OS opener), `same-origin` (the confirmation click), `same-site`, and a client that sends no such header are served. Neither state mechanism covers this direction on its own — the navigation carrying the attack is also the one that mints the state and sets its cookie. |
| A CLI authorization code observed on the plaintext loopback hop | The code is proof-of-possession, not bearer: `login` registers `sha256(verifier)` as `?challenge=` and `POST /auth/cli/exchange` requires `{ code, verifier }`. The verifier never leaves the CLI process, and a login that registered no challenge is refused at the callback rather than issued a weaker code. |
