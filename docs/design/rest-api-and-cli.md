---
title: rest-api-and-cli
target-version: 0.2.0
---

# REST API, API Key Authentication, and CLI

## Summary

Add API key authentication and a versioned REST API (`/api/v1/`) so external
programs can read and write spreadsheet data. Provide a CLI (`wafflebase`)
that wraps the REST API for terminal-based workflows: data pipelines,
scripting, CSV/JSON import/export, and document management. API keys are
scoped to a single workspace and authenticate via the `Authorization:
Bearer wfb_xxx` header. Cell data is accessed through a server-side Yorkie
client that attaches to the CRDT document on each request.

### Goals

- Let external systems (scripts, integrations, other services) access
  document and cell data without a browser session.
- Provide a workspace-scoped API key that owners can create, list, and
  revoke from the web UI.
- Expose full CRUD for documents, tabs, and cells through a stable,
  versioned REST API.
- Reuse Yorkie CRDT for cell reads and writes so that API mutations merge
  conflict-free with live collaborative edits.
- Ship a cross-platform CLI (`wafflebase`) written in Go that wraps the
  REST API for data pipelines, scripting, and document management.

### Non-Goals

- Real-time streaming or WebSocket API (clients use Yorkie directly for
  that).
- Granular per-document or per-cell permission scoping on API keys (may be
  added later).
- Rate limiting or usage metering (deferred to a future iteration).
- Frontend UI for API key management (can be added later; initial management
  is via the REST endpoints themselves).

## Proposal Details

### 1. API Key Model

A new `ApiKey` Prisma model stores hashed keys scoped to a workspace.

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
base64url (~47 characters total). The raw key is returned exactly once at
creation time. Only the SHA-256 hash is stored.

### 2. API Key Management Endpoints

All management endpoints require JWT authentication (existing `JwtAuthGuard`)
and workspace owner role.

```
POST   /workspaces/:workspaceId/api-keys       Create key (returns raw key once)
GET    /workspaces/:workspaceId/api-keys       List keys (prefix only, no hash)
DELETE /workspaces/:workspaceId/api-keys/:id   Revoke key (sets revokedAt)
```

### 3. Authentication Flow

A new `CombinedAuthGuard` inspects the request and delegates to the
appropriate strategy:

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
      └─ JwtAuthGuard (existing cookie-based flow)
```

The v1 API endpoints use `CombinedAuthGuard`. Existing endpoints continue
to use `JwtAuthGuard` only.

### 4. Yorkie Service

A backend service maintains a single Yorkie `Client` connected to the Yorkie
server. Each REST API call uses a short-lived document attachment:

```
withDocument(documentId, callback):
  doc = new Document("sheet-{documentId}")
  client.attach(doc, syncMode: manual)
  try:
    result = callback(doc)
  finally:
    client.detach(doc)
  return result
```

This pattern is stateless and safe for concurrent REST calls. Yorkie's CRDT
ensures that writes from the API merge conflict-free with live user edits.

**Configuration**: `YORKIE_RPC_ADDR` environment variable (default:
`http://localhost:8080`).

**Dependency**: `@yorkie-js/sdk` added to `packages/backend/package.json`,
matching the version family used by the frontend (`@yorkie-js/react` 0.6.49).

**Types**: `SpreadsheetDocument`, `Worksheet`, and `TabMeta` are duplicated
from `packages/frontend/src/types/worksheet.ts` into a backend-local
Yorkie types file. Cell-level types (`Cell`, `Sref`, `CellStyle`) are
imported from `@wafflebase/sheet`.

### 5. REST API v1 Endpoints

All endpoints are prefixed with `/api/v1/` and protected by
`CombinedAuthGuard`. For API key auth, the `:workspaceId` parameter must
match the key's bound workspace. For JWT auth, workspace membership is
checked via `WorkspaceService.assertMember()`.

#### Documents

```
GET    /api/v1/workspaces/:wid/documents              List documents
POST   /api/v1/workspaces/:wid/documents              Create document
GET    /api/v1/workspaces/:wid/documents/:did          Get document metadata
PATCH  /api/v1/workspaces/:wid/documents/:did          Update document (title)
DELETE /api/v1/workspaces/:wid/documents/:did          Delete document
```

These delegate to the existing `DocumentService` for Prisma operations.

#### Tabs

```
GET    /api/v1/workspaces/:wid/documents/:did/tabs     List tabs (id, name, type, order)
```

Reads tab metadata from the Yorkie document via `YorkieService`.

#### Cells

```
GET    /api/v1/.../tabs/:tid/cells                     Get cells (optional ?range=A1:C10)
GET    /api/v1/.../tabs/:tid/cells/:sref               Get single cell
PUT    /api/v1/.../tabs/:tid/cells/:sref               Set single cell
DELETE /api/v1/.../tabs/:tid/cells/:sref                Delete single cell
PATCH  /api/v1/.../tabs/:tid/cells                     Batch update cells
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

Setting a cell to `null` deletes it. All mutations within a single batch
request are applied in one Yorkie `doc.update()` call for atomicity.

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
      workspace-scope.guard.ts
```

Registered in the root application module: `ApiKeyModule`, `YorkieModule`, `ApiV1Module`.

### 7. CLI (`wafflebase`)

A standalone command-line tool written in Go that wraps the REST API. It
lives in a new top-level directory `cli/` outside the pnpm monorepo.

#### 7.1 Technology

- **Language**: Go (single static binary, cross-platform)
- **CLI framework**: [cobra](https://github.com/spf13/cobra)
- **HTTP client**: `net/http` (standard library)
- **Output formats**: table (default), JSON (`--json`), CSV (`--csv`)
- **Distribution**: `go install`, GitHub Releases (prebuilt binaries for
  linux/darwin/windows amd64/arm64), Homebrew tap

#### 7.2 Configuration

The CLI reads credentials from a config file and environment variables.

```
# ~/.config/wafflebase/config.yaml (or $WAFFLEBASE_CONFIG)
profiles:
  default:
    server: https://app.wafflebase.io
    api-key: wfb_xxxxx
    workspace: ws-uuid-here
  local:
    server: http://localhost:3000
    api-key: wfb_yyyyy
    workspace: ws-uuid-here
```

**Precedence** (highest to lowest):
1. Flags: `--server`, `--api-key`, `--workspace`
2. Environment: `WAFFLEBASE_SERVER`, `WAFFLEBASE_API_KEY`,
   `WAFFLEBASE_WORKSPACE`
3. Config file profile (selected with `--profile`, default: `default`)

#### 7.3 Command Tree

```
wafflebase
├── auth
│   └── login                   Interactive API key setup → writes config
│
├── document (alias: doc)
│   ├── list                    List documents in workspace
│   ├── create <title>          Create a new document
│   ├── get <doc-id>            Show document metadata
│   ├── rename <doc-id> <title> Rename a document
│   └── delete <doc-id>        Delete a document
│
├── tab
│   └── list <doc-id>          List tabs in a document
│
├── cell
│   ├── get <doc-id> [<range>]  Get cells (default: all, or A1, or A1:C10)
│   ├── set <doc-id> <ref> <value>  Set a single cell value
│   └── delete <doc-id> <ref>  Delete a single cell
│
├── import <doc-id> <file>     Import CSV/JSON into a tab
│   --tab <tab-id>              Target tab (default: first tab)
│   --format csv|json           Auto-detected from extension
│   --header                    First row is header (CSV, default: true)
│   --start <ref>               Top-left cell to start import (default: A1)
│
├── export <doc-id> <file>     Export tab data to CSV/JSON
│   --tab <tab-id>              Source tab (default: first tab)
│   --range <range>             Export range (default: all data)
│   --format csv|json           Auto-detected from extension
│
├── api-key
│   ├── create <name>           Create a new API key
│   ├── list                    List API keys in workspace
│   └── revoke <key-id>        Revoke an API key
│
└── version                    Print CLI version
```

**Global flags**: `--server`, `--api-key`, `--workspace`, `--profile`,
`--json`, `--csv`, `--quiet`, `--verbose`

#### 7.4 Usage Examples

```bash
# Setup
wafflebase auth login

# List documents
wafflebase doc list

# Read cells
wafflebase cell get abc-123                      # all cells, table format
wafflebase cell get abc-123 A1:C10               # range
wafflebase cell get abc-123 A1:C10 --json        # JSON output
wafflebase cell get abc-123 --tab tab-2          # specific tab

# Write cells
wafflebase cell set abc-123 A1 "Hello World"
wafflebase cell set abc-123 B2 "=SUM(A1:A10)"

# Import/Export
wafflebase import abc-123 data.csv
wafflebase export abc-123 output.json --range A1:D100

# Pipe-friendly (reads from stdin, writes to stdout)
cat data.csv | wafflebase import abc-123 -
wafflebase export abc-123 - --format csv | head -20

# API key management
wafflebase api-key create "CI Pipeline"
wafflebase api-key list
wafflebase api-key revoke key-uuid
```

#### 7.5 Project Structure

```
cli/
  go.mod
  go.sum
  main.go
  cmd/
    root.go            Root command, global flags, config loading
    auth.go            auth login
    document.go        document list/create/get/rename/delete
    tab.go             tab list
    cell.go            cell get/set/delete
    import.go          import CSV/JSON
    export.go          export CSV/JSON
    apikey.go          api-key create/list/revoke
    version.go         version
  internal/
    client/
      client.go        HTTP client wrapping REST API v1
      types.go         Request/response types
    config/
      config.go        Config file + env + flag resolution
    output/
      table.go         Table formatter
      json.go          JSON formatter
      csv.go           CSV formatter
  Makefile             Build targets for all platforms
```

#### 7.6 Design Principles

- **Stdin/stdout friendly**: support `-` as filename for piping.
- **Scriptable**: `--json` output for machine consumption, `--quiet` to
  suppress non-essential output, exit codes for success (0) and failure (1).
- **Progressive disclosure**: simple commands for common tasks, flags for
  advanced options.
- **Offline-safe**: the CLI is stateless; all state lives on the server.

### 8. Implementation Order

1. Prisma schema — add `ApiKey` model, run migration
2. API Key module — service, controller, guard, strategy
3. Combined auth guard
4. Yorkie types + service
5. REST API v1 controllers (documents → tabs → cells)
6. Register modules in the root application module
7. Backend tests
8. CLI scaffold — Go project, config loading, HTTP client
9. CLI commands — document, tab, cell, import/export, api-key
10. CLI tests and cross-platform build

### Risks and Mitigation

| Risk | Mitigation |
|------|------------|
| Yorkie SDK may behave differently in Node.js vs browser | Verify with a spike; the SDK uses gRPC-web which works in Node.js. Fall back to direct gRPC if needed. |
| Attach/detach per request adds latency | Acceptable for v1. A connection pool with LRU eviction can be added later if latency becomes a problem. |
| Concurrent API writes and live user edits | Yorkie CRDT handles conflict-free merging by design. Document this for API consumers. |
| API key leakage | Store only SHA-256 hashes. Show raw key once at creation. Support revocation and optional expiration. |
| SpreadsheetDocument type duplication | Keep a backend-local copy. Long-term, move shared types to `@wafflebase/sheet`. |
| CLI binary size and distribution | Go produces small static binaries (~10 MB). Use GitHub Releases and Homebrew for distribution. |
| CLI and API version drift | CLI includes `version` command; REST API is versioned (`/api/v1/`). CLI checks API compatibility on startup. |
