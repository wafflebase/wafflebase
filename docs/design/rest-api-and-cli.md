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
- Ship a CLI (`wafflebase`) as a TypeScript package within the pnpm
  monorepo that wraps the REST API for data pipelines, scripting, and
  document management.
- Make the CLI first-class for AI agent consumption: structured output,
  self-describing schema, dry-run support, and bundled skill definitions.

### Non-Goals

- Real-time streaming or WebSocket API (clients use Yorkie directly for
  that).
- Granular per-document or per-cell permission scoping on API keys (may be
  added later).
- Rate limiting or usage metering (deferred to a future iteration).
- Frontend UI for API key management (can be added later; initial management
  is via the REST endpoints themselves).
- MCP server (may be added later as a thin wrapper over the REST API).

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

A TypeScript CLI package (`@wafflebase/cli`) within the pnpm monorepo at
`packages/cli/`. Living inside the monorepo lets the CLI import types
directly from `@wafflebase/sheet`, share the existing lint/test/build
toolchain, and avoid the type-duplication problem of a separate Go project.

#### 7.1 Technology

- **Language**: TypeScript (same toolchain as the rest of the monorepo)
- **CLI framework**: [commander](https://github.com/tj/commander.js)
  (lightweight, well-maintained, subcommand support)
- **HTTP client**: built-in `fetch` (Node.js 18+)
- **Output formats**: JSON (default), table (`--format table`),
  CSV (`--format csv`), YAML (`--format yaml`)
- **Config files**: [yaml](https://www.npmjs.com/package/yaml) for
  `~/.config/wafflebase/config.yaml`
- **Distribution**: `npx @wafflebase/cli`, `npm install -g @wafflebase/cli`,
  or `pnpm dlx @wafflebase/cli`

JSON is the default output format because agents and scripts are the
primary consumers. Human users can switch to `--format table` for
readability.

**Why TypeScript over Go**:
- Shares types with `@wafflebase/sheet` — no duplication of `Cell`,
  `Sref`, `CellStyle`, `SpreadsheetDocument`
- Single toolchain — no separate Go compiler, linter, or CI pipeline
- AI agent environments (Claude Code, Cursor) already have Node.js
- Can be converted to a standalone binary later via `bun build --compile`
  if single-binary distribution becomes important

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
├── login                        Browser OAuth login → writes session
├── logout                       Clear session
├── status                       Show auth state
│
├── ctx
│   ├── list                     List workspaces (* = active)
│   └── switch <name|id>         Switch active workspace
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
│   ├── batch <doc-id>          Batch update cells (JSON from stdin or --data)
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
├── schema [<command>]          Describe command parameters and response shape
│
├── api-key
│   ├── create <name>           Create a new API key
│   ├── list                    List API keys in workspace
│   └── revoke <key-id>        Revoke an API key
│
└── version                    Print CLI version
```

**Global flags**: `--server`, `--api-key`, `--workspace`, `--profile`,
`--format json|table|csv|yaml` (default: json), `--quiet`, `--verbose`,
`--dry-run`

#### 7.4 Usage Examples

```bash
# Login
wafflebase login

# List documents (JSON by default)
wafflebase doc list
wafflebase doc list --format table        # human-readable table

# Read cells
wafflebase cell get abc-123               # all cells, JSON
wafflebase cell get abc-123 A1:C10        # range
wafflebase cell get abc-123 --tab tab-2   # specific tab

# Write cells
wafflebase cell set abc-123 A1 "Hello World"
wafflebase cell set abc-123 B2 "=SUM(A1:A10)"

# Batch update (JSON from stdin)
echo '{"A1":"Name","B1":"Score","A2":"Alice","B2":"95"}' \
  | wafflebase cell batch abc-123

# Dry-run: show the request without executing
wafflebase cell set abc-123 A1 "Hello" --dry-run

# Import/Export
wafflebase import abc-123 data.csv
wafflebase export abc-123 output.json --range A1:D100

# Pipe-friendly (reads from stdin, writes to stdout)
cat data.csv | wafflebase import abc-123 -
wafflebase export abc-123 - --format csv | head -20

# Schema introspection
wafflebase schema cell.get               # show parameters and response shape
wafflebase schema cell.batch             # show batch update format

# API key management
wafflebase api-key create "CI Pipeline"
wafflebase api-key list
wafflebase api-key revoke key-uuid
```

#### 7.5 Project Structure

```
packages/cli/
  package.json           @wafflebase/cli, bin: { "wafflebase": "./dist/bin.js" }
  tsconfig.json
  vitest.config.ts
  src/
    bin.ts               Entry point (#!/usr/bin/env node)
    commands/
      root.ts            Root program, global flags, config loading
      login.ts           login (browser OAuth)
      logout.ts          logout
      status.ts          status
      ctx.ts             ctx list/switch
      document.ts        doc list/create/get/rename/delete
      tab.ts             tab list
      cell.ts            cell get/set/batch/delete
      import.ts          import CSV/JSON
      export.ts          export CSV/JSON
      schema.ts          schema introspection
      api-key.ts         api-key create/list/revoke
    client/
      http-client.ts     REST API v1 wrapper (built-in fetch)
      dry-run.ts         Dry-run request printer
      types.ts           Request/response types (re-exports from @wafflebase/sheet)
    config/
      config.ts          Config file + env + flag resolution
    output/
      formatter.ts       Format dispatcher (json | table | csv | yaml)
      table.ts           Table formatter
      json.ts            JSON formatter
      csv.ts             CSV formatter
      yaml.ts            YAML formatter
    schema/
      registry.ts        Command metadata registry for introspection
  skills/                Agent skill definitions (Markdown)
    SKILL.md             Skill index and conventions
    read-cells.md        Read cell data from a spreadsheet
    write-cells.md       Write cell data to a spreadsheet
    manage-docs.md       Create, list, and delete documents
    import-export.md     Import/export CSV and JSON data
    recipe-csv-pipeline.md   Multi-step recipe: CSV → spreadsheet → analyze
    recipe-data-collect.md   Multi-step recipe: collect data across documents
```

**package.json** (key fields):

```json
{
  "name": "@wafflebase/cli",
  "version": "0.1.0",
  "bin": { "wafflebase": "./dist/bin.js" },
  "dependencies": {
    "@wafflebase/sheet": "workspace:*",
    "commander": "^13.0.0",
    "yaml": "^2.0.0"
  },
  "devDependencies": {
    "vitest": "^3.0.0",
    "typescript": "^5.8.0"
  }
}
```

**Root pnpm scripts** (added to the monorepo root `package.json`):

```json
{
  "cli": "pnpm --filter @wafflebase/cli",
  "cli:dev": "pnpm --filter @wafflebase/cli dev"
}
```

**Usage during development**:

```bash
# Run directly in the monorepo
pnpm cli dev -- doc list

# After npm publish
npx @wafflebase/cli doc list

# Global install
npm install -g @wafflebase/cli
wafflebase doc list
```

#### 7.6 Design Principles

- **Stdin/stdout friendly**: support `-` as filename for piping.
- **Scriptable**: JSON output by default for machine consumption, `--quiet`
  to suppress non-essential output, exit codes for success (0) and failure (1).
- **Progressive disclosure**: simple commands for common tasks, flags for
  advanced options.
- **Offline-safe**: the CLI is stateless; all state lives on the server.

#### 7.7 Agent Integration

The CLI is designed to be a first-class tool for AI agents (Claude Code,
Gemini CLI, Cursor, etc.). This section describes the patterns that make the
CLI agent-friendly, inspired by the
[Google Workspace CLI](https://github.com/googleworkspace/cli).

##### 7.7.1 Structured Output

All output is JSON by default. Errors are also JSON so agents can parse
success and failure uniformly:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Document abc-123 not found",
    "command": "cell.get"
  }
}
```

Exit codes: `0` success, `1` user error (bad input, not found),
`2` system error (network, auth). Agents can branch on the exit code
without parsing the error body.

##### 7.7.2 Dry-Run

The `--dry-run` flag validates inputs, resolves the target API endpoint,
and prints the request that would be sent — without executing it. This
lets agents verify intent before committing to a write operation.

```bash
$ wafflebase cell set abc-123 A1 "Revenue" --dry-run
{
  "dry_run": true,
  "method": "PUT",
  "url": "https://api.wafflebase.io/api/v1/workspaces/ws-1/documents/abc-123/tabs/default/cells/A1",
  "body": { "value": "Revenue" }
}
```

##### 7.7.3 Schema Introspection

The `schema` command lets agents discover command parameters and response
shapes at runtime, without consulting external documentation.

```bash
# Show parameters for a command
$ wafflebase schema cell.get
{
  "command": "cell.get",
  "description": "Get cells from a spreadsheet tab",
  "parameters": {
    "doc-id":  { "type": "string", "required": true, "description": "Document ID" },
    "range":   { "type": "string", "required": false, "description": "Cell range (e.g. A1:C10)", "default": "all" },
    "--tab":   { "type": "string", "required": false, "description": "Tab ID", "default": "first tab" }
  },
  "response": {
    "type": "array",
    "items": {
      "ref": "string",
      "value": "string | number | boolean | null",
      "formula": "string | null",
      "style": "object | null"
    }
  },
  "safety": "read-only"
}

# List all available commands
$ wafflebase schema
{
  "commands": [
    { "name": "doc.list",    "safety": "read-only" },
    { "name": "doc.create",  "safety": "write" },
    { "name": "doc.delete",  "safety": "destructive" },
    { "name": "cell.get",    "safety": "read-only" },
    { "name": "cell.set",    "safety": "write" },
    { "name": "cell.batch",  "safety": "write" },
    { "name": "cell.delete", "safety": "destructive" },
    ...
  ]
}
```

##### 7.7.4 Safety Annotations

Every command has a `safety` level that agents can use to decide whether
to auto-execute or ask the user for confirmation:

| Level | Meaning | Agent behavior |
|-------|---------|----------------|
| `read-only` | No side effects | Safe to execute without confirmation |
| `write` | Creates or modifies data | Agent should confirm or use `--dry-run` first |
| `destructive` | Deletes data irreversibly | Agent must ask for user confirmation |

Safety levels are exposed via `wafflebase schema` and embedded in skill
definitions. This aligns with how Claude Code handles tool approval:
read-only tools run freely, write tools require user approval.

##### 7.7.5 Skills

Skills are Markdown files in the `packages/cli/skills/` directory that serve
as self-contained instruction sets for AI agents. Each skill describes a
focused capability with command syntax, examples, and safety notes. Agents
load the relevant skill file and follow its instructions.

Skill files follow this structure:

```markdown
---
name: read-cells
description: Read cell data from a Wafflebase spreadsheet
safety: read-only
tools:
  - wafflebase cell get
  - wafflebase tab list
---

# Read Cells

## When to Use
When the user wants to read, inspect, or analyze spreadsheet data.

## Commands

### List tabs in a document
\`\`\`bash
wafflebase tab list <doc-id>
\`\`\`

### Read all cells
\`\`\`bash
wafflebase cell get <doc-id>
\`\`\`

### Read a specific range
\`\`\`bash
wafflebase cell get <doc-id> A1:C10
wafflebase cell get <doc-id> A1:C10 --tab <tab-id>
\`\`\`

## Output Format
Returns a JSON array of cell objects:
\`\`\`json
[
  { "ref": "A1", "value": "Name", "formula": null, "style": null },
  { "ref": "B1", "value": "42", "formula": "=SUM(B2:B10)", "style": { "bold": true } }
]
\`\`\`

## Safety
read-only — no data is modified. Safe to execute without user confirmation.
```

##### 7.7.6 Recipes

Recipes are multi-step workflow templates that compose multiple CLI
commands. They live alongside skills in the `packages/cli/skills/`
directory and are prefixed with `recipe-`. Agents can follow recipes to accomplish complex
tasks that span multiple commands.

```markdown
---
name: recipe-csv-pipeline
description: Import a CSV file, apply formulas, and export results
safety: write
---

# CSV Analysis Pipeline

## Steps

1. Create a new document:
   \`\`\`bash
   wafflebase doc create "Q1 Analysis"
   \`\`\`

2. Import CSV data:
   \`\`\`bash
   wafflebase import <doc-id> data.csv
   \`\`\`

3. Add summary formulas:
   \`\`\`bash
   echo '{"E1":"Total","E2":"=SUM(B2:B100)","E3":"Average","E4":"=AVERAGE(B2:B100)"}' \
     | wafflebase cell batch <doc-id>
   \`\`\`

4. Export results:
   \`\`\`bash
   wafflebase export <doc-id> - --format csv --range A1:E100
   \`\`\`
```

##### 7.7.7 How Agents Discover and Use the CLI

An agent integrates with the Wafflebase CLI through this flow:

```
1. Agent loads skill/recipe files (bundled with CLI or fetched from repo)
2. Reads skill frontmatter to understand safety and available tools
3. Uses `wafflebase schema <command>` to check parameter details
4. For writes, runs with `--dry-run` to show intent to user
5. Executes the command, parses JSON output
6. On error, parses the JSON error response to decide next action
```

No special SDK, MCP server, or API wrapper is needed. The CLI itself is the
agent interface. This approach has key advantages:

- **Zero integration cost**: any agent that can run shell commands works.
- **Self-describing**: `schema` and skill files eliminate documentation lookup.
- **Safe by default**: safety annotations + dry-run prevent accidental data loss.
- **Composable**: recipes show agents how to chain commands for complex tasks.

### 8. Implementation Order

1. Prisma schema — add `ApiKey` model, run migration
2. API Key module — service, controller, guard, strategy
3. Combined auth guard
4. Yorkie types + service
5. REST API v1 controllers (documents → tabs → cells)
6. Register modules in the root application module
7. Backend tests
8. CLI scaffold — `packages/cli`, commander setup, config loading, HTTP client
9. CLI commands — document, tab, cell (including batch), import/export, api-key
10. Schema registry and `schema` command
11. Dry-run support in HTTP client layer
12. Skill and recipe Markdown files
13. CLI tests and npm publish setup

### Risks and Mitigation

| Risk | Mitigation |
|------|------------|
| Yorkie SDK may behave differently in Node.js vs browser | Verify with a spike; the SDK uses gRPC-web which works in Node.js. Fall back to direct gRPC if needed. |
| Attach/detach per request adds latency | Acceptable for v1. A connection pool with LRU eviction can be added later if latency becomes a problem. |
| Concurrent API writes and live user edits | Yorkie CRDT handles conflict-free merging by design. Document this for API consumers. |
| API key leakage | Store only SHA-256 hashes. Show raw key once at creation. Support revocation and optional expiration. |
| SpreadsheetDocument type duplication (backend) | Keep a backend-local copy. Long-term, move shared types to `@wafflebase/sheet`. CLI already imports directly. |
| CLI requires Node.js runtime | Acceptable for v1 — target users (developers, CI, AI agents) have Node.js. Can produce standalone binary later via `bun build --compile`. |
| CLI and API version drift | CLI includes `version` command; REST API is versioned (`/api/v1/`). CLI checks API compatibility on startup. |
| Skill files become outdated | Keep skills next to the CLI source. CI can validate that skill tool references match real commands. |
| Agents bypassing safety levels | Safety is advisory; the server enforces actual permissions via API key scopes. Safety annotations help agents make better decisions but are not access control. |
