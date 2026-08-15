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

- **`GET /auth/github?mode=cli&port=<port>&nonce=<nonce>&code_challenge=<challenge>`**
  — extends the existing endpoint to carry CLI parameters through OAuth
  `state`. The backend generates an opaque state token (random 32 bytes,
  TTL 5 minutes, in-memory map) and remembers the CLI's `nonce`, its PKCE
  `code_challenge`, and a third random value beside it — the value of a
  short-lived `wafflebase_cli_state` cookie set on the browser being
  sent to GitHub, which binds the login to that browser (see the risk
  rows). That cookie is deliberately named apart from the browser flow's
  `wafflebase_oauth_state`: one browser can hold both logins at once, and a
  shared name let the second start overwrite the first's binding.
  All three query parameters are **required**: absent, empty, or
  outside their bounds is a `400` naming the parameter, never a login
  that continues unbound — and, for `port`, never a silent fall-through to
  the browser flow, which would issue the person real session cookies for a
  sign-in they asked to hand to a terminal while the CLI waited out a
  callback that was never coming. The bounds are `port` at 1024–65535, the
  nonce at 128 characters and
  the challenge at RFC 7636's 43–128 plus the base64url alphabet, since
  they arrive on an attacker-influenceable query string and two are echoed
  into a redirect URL. Treating them as optional would leave the
  RFC 8252 §8.9 injection open for any client that just omits them — on
  the wire "does not support it" and "chose not to send it" are the same
  request. A `mode=cli` start does not reach GitHub on its own either: it
  renders a consent interstitial naming the loopback port, gated on the
  `wafflebase_cli_confirm` cookie that page sets, and only the click on it
  starts the authorization request.
  A request with no `mode=cli` is a browser login and gets a `state` too:
  the HMAC of a random value held in a short-lived
  `wafflebase_oauth_state` cookie, sent as `w.<signature>`, so the callback
  has something to check (see the CSRF risk row).
- **`GET /auth/github/callback`** — validates `state` first: a `w.`-prefixed
  one against the HMAC of its `wafflebase_oauth_state` cookie, anything else
  against the CLI state map *and* the `wafflebase_cli_state` cookie, and a
  callback carrying none at all is a `401`. Either
  way that flow's own cookie is single-use and cleared whether or not it
  matched; the other flow's is left untouched, so a login of one kind
  finishing or failing does not break one of the other kind in flight. When
  the decoded state has
  `mode === 'cli'`, generates a short-lived authorization code (random,
  TTL 60 seconds, same in-memory map, carrying the state's
  `code_challenge`), redirects to
  `http://127.0.0.1:<port>/callback?code=<auth-code>&state=<nonce>`.
  `port` must be `1024–65535`; the redirect host is always `127.0.0.1`
  (hard-coded). The `state` echo is what lets the CLI tell its own
  flow's code from one pushed at its guessable callback port
  (RFC 8252 §8.9).
- **`POST /auth/cli/exchange`** — accepts `{ code, codeVerifier? }`,
  looks the code up, validates TTL, deletes it (single-use), and returns
  `{ accessToken, refreshToken }`. No authentication required — the CLI
  has no credential yet — so the code must not be a plain bearer: a code
  minted from a login that carried a `code_challenge` only redeems
  against the matching PKCE verifier (S256, constant-time compare). A
  mismatch burns the code and is reported as an ordinary
  "invalid or expired code", so the endpoint is no oracle. A code from a
  CLI that sent no challenge stays redeemable on its own, but only from a
  caller that presents no verifier — a verifier against an unchallenged
  code is refused (RFC 7636 §4.6), which is what stops an unchallenged
  login from being passed off to a PKCE-capable CLI.
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
| OAuth state forgery (CSRF) on the **CLI** flow | The `state` GitHub carries is an opaque random 32-byte token, minted for every `mode=cli` request into a 5-minute in-memory map and consumed single-use on callback; an unknown or expired one is a 400, never a fall-through to the web flow. It is also bound to one browser: `StateEntry.browserBinding` is the value of the `wafflebase_cli_state` cookie set when the login started (its own name, so a concurrent browser login cannot overwrite it), and a callback that does not present it is a 400 refused **before** the user is looked up. A `mode=cli' start also stops on a consent interstitial naming the loopback port, gated on the `wafflebase_cli_confirm` cookie that page sets, so a link the victim merely clicks does not reach GitHub. That interstitial is served `X-Frame-Options: DENY` + `frame-ancestors 'none'` (and `no-store`), because a confirmation whose only strength is that a person meant to press it is exactly what a framing overlay steals — and `SameSite=Lax` on the confirm cookie stops only a cross-site framer, not a same-site page. Without that binding an attacker could mint a CLI state pointing at a loopback port they own and walk the victim through consent, ending up with an authorization code for the victim's account — which the nonce and PKCE do not see, since the attacker holds both. |
| OAuth state forgery (CSRF) on the **browser** flow | `GitHubAuthGuard` mints a `state` for every authorization request, not just `mode=cli`: a browser login gets a random 32-byte value stored in a 5-minute httpOnly `wafflebase_oauth_state` cookie (`SameSite=Lax`, `Path=/`, `__Host-`-prefixed on any https deployment) and sends its **HMAC** to GitHub under a `w.` prefix, which the callback recomputes and compares constant-time before clearing the cookie. The signature stops a `state` this server never issued from being invented; it is *not* a defence against cookie planting, since one unauthenticated `GET /auth/github` hands any caller a matching pair — `__Host-` is what closes that, which is why it follows the deployment scheme rather than `NODE_ENV`. A double submit rather than a server-side entry, because the callback may land on a different replica than the one that started the login. A callback whose `state` is missing, unprefixed-but-unknown, or does not match its cookie is refused **before** the user is looked up — so an attacker can no longer complete consent for their own account and have a victim's browser issued cookies for it (forced login). |
| Login secrets in access logs | The `req` serializer replaces the query string of any `/auth` URL with `?<redacted>`. `/auth` query strings carry single-use login material — the CLI's `nonce` and `code_challenge` outbound, GitHub's `code` and `state` inbound — and every 4xx there is logged at `warn`, so an unredacted line would park a replayable login in the access log. Other paths keep their query, which is what distinguishes two calls. |
| Authorization-code injection at the CLI's loopback port (RFC 8252 §8.9) | The CLI's `nonce` is echoed back as `state` and compared constant-time before any code is redeemed, so a code pushed at the guessable port is refused; PKCE S256 independently makes an intercepted code unredeemable without the verifier, which never leaves the CLI process. Both are required on the start URL, so a client cannot opt out of either by omitting it. A verifier presented against a code minted with *no* challenge is refused too (RFC 7636 §4.6), so the second binding cannot be downgraded away by starting an unchallenged login at the victim's port. |
