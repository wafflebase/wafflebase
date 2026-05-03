---
title: rest-api-and-cli
target-version: 0.3.7
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
imported from `@wafflebase/sheets`.

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
directly from `@wafflebase/sheets`, share the existing lint/test/build
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
- Shares types with `@wafflebase/sheets` — no duplication of `Cell`,
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

The v0.3.7 namespaces are plural (`docs`, `sheets`, `api-keys`); singular
forms (`doc`, `sheet`, `tab`, `cell`, `api-key`) keep working as aliases
for earlier scripts. Word-processor commands (`docs content`, `docs export`,
`docs import`) live alongside the document-management ones — see
[`docs/design/docs-cli.md`](docs-cli.md) for the design notes that drive
the docs-side surface.

```
wafflebase
├── login                                  Browser OAuth login → writes session
├── logout                                 Clear session
├── status                                 Show auth state
│
├── ctx
│   ├── list                              List workspaces (* = active)
│   └── switch <name|id>                  Switch active workspace
│
├── docs (aliases: doc, document, documents)
│   ├── list [--type doc|sheet]           List documents in workspace
│   ├── create <title> [--type doc|sheet] Create a new document (default: sheet)
│   ├── get <doc-id>                      Show document metadata
│   ├── rename <doc-id> <title>           Rename a document
│   ├── delete <doc-id>                   Delete a document
│   ├── content <doc-id>                  Read content (json|md|text + --pages)
│   ├── export <doc-id> <file>            Export to PDF or DOCX (+ --pages for PDF)
│   └── import <file>                     Import a .docx (default: new doc; --replace --yes to overwrite)
│
├── sheets (aliases: sheet, spreadsheet, spreadsheets)
│   ├── tabs (alias: tab)
│   │   └── list <doc-id>                 List tabs in a spreadsheet
│   ├── cells (alias: cell)
│   │   ├── get <doc-id> [<range>]        Get cells (default: all, or A1, or A1:C10)
│   │   ├── set <doc-id> <ref> <value>    Set a single cell value
│   │   ├── batch <doc-id>                Batch update cells (JSON from stdin or --data)
│   │   └── delete <doc-id> <ref>         Delete a single cell
│   ├── import <doc-id> <file>            Import CSV/JSON into a tab
│   │   --tab <tab-id>                    Target tab (default: tab-1)
│   │   --file-format csv|json            Auto-detected from extension
│   │   --start <ref>                     Top-left cell to start import (default: A1)
│   └── export <doc-id> <file>            Export tab data to CSV/JSON
│       --tab <tab-id>                    Source tab (default: tab-1)
│       --range <range>                   Export range (default: all data)
│       --file-format csv|json            Auto-detected from extension
│
├── schema [<command>]                    Describe command parameters and response shape
│
├── api-keys (alias: api-key)
│   ├── create <name>                     Create a new API key
│   ├── list                              List API keys in workspace
│   └── revoke <key-id>                   Revoke an API key
│
└── version                               Print CLI version
```

**Global flags**: `--server`, `--api-key`, `--workspace`, `--profile`,
`--format json|table|csv|yaml` (default: json), `--quiet`, `--verbose`,
`--dry-run`. The `--format` flag also doubles as the per-content shape on
`docs content` (`json|md|text`) and `docs export` (`pdf|docx`); commander
funnels duplicate flag names to the global option, so the action layer
reads `opts.format` and validates against the per-command vocabulary.

#### 7.4 Usage Examples

```bash
# Login
wafflebase login

# List documents (JSON by default)
wafflebase docs list
wafflebase docs list --type doc           # only word-processor docs
wafflebase docs list --format table       # human-readable table

# Read cells (sheets namespace)
wafflebase sheets cells get abc-123                 # all cells, JSON
wafflebase sheets cells get abc-123 A1:C10          # range
wafflebase sheets cells get abc-123 --tab tab-2     # specific tab

# Write cells
wafflebase sheets cells set abc-123 A1 "Hello World"
wafflebase sheets cells set abc-123 B2 "=SUM(A1:A10)" --formula

# Batch update (JSON from stdin)
echo '{"A1":"Name","B1":"Score","A2":"Alice","B2":"95"}' \
  | wafflebase sheets cells batch abc-123

# Dry-run: show the request without executing
wafflebase sheets cells set abc-123 A1 "Hello" --dry-run

# Import/Export (sheets — CSV/JSON)
wafflebase sheets import abc-123 data.csv
wafflebase sheets export abc-123 output.json --range A1:D100

# Pipe-friendly (reads from stdin, writes to stdout)
cat data.csv | wafflebase sheets import abc-123 -
wafflebase sheets export abc-123 - --file-format csv | head -20

# Word-processor docs
wafflebase docs content abc-123 --format md           # render as Markdown
wafflebase docs content abc-123 --format text --pages 1-3
wafflebase docs export abc-123 out.pdf                # export to PDF
wafflebase docs export abc-123 out.pdf --pages 1-3    # exact page subset
wafflebase docs export abc-123 out.docx               # export to DOCX
wafflebase docs import draft.docx                     # new doc from .docx
wafflebase docs import revision.docx --replace abc-123 --yes

# Schema introspection (canonical plural names — singular aliases also resolve)
wafflebase schema sheets.cells.get        # show parameters and response shape
wafflebase schema docs.content
wafflebase schema cell.get                # alias → resolves to sheets.cells.get

# API key management
wafflebase api-keys create "CI Pipeline"
wafflebase api-keys list
wafflebase api-keys revoke key-uuid
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
      docs.ts            docs list/create/get/rename/delete + content/export/import
      sheets.ts          Dispatcher: sheets {tabs,cells,import,export}
      tabs.ts            sheets tabs list
      cells.ts           sheets cells get/set/batch/delete
      sheets-import.ts   sheets import CSV/JSON
      sheets-export.ts   sheets export CSV/JSON
      schema.ts          schema introspection
      api-keys.ts        api-keys create/list/revoke
    docs/                Word-processor pipeline (Phase 5-8 additions)
      content.ts         runDocsContent orchestrator (json/md/text + --pages)
      pdf-export.ts      exportPdf via PdfExporter + FontkitMeasurer + pdf-lib slicing
      docx-export.ts     exportDocx wrapper around DocxExporter
      docx-import.ts     importDocx + base64 ImageUploader + InvalidDocxError
      import.ts          runDocsImport orchestrator (POST + PUT, --replace flow)
      paginate.ts        paginateForCli helper (computeLayout + paginateLayout)
      page-range.ts      parsePageRange (1-3,5,7-9 + clamp warnings)
      page-slice.ts      sliceBlocksByPages
      fontkit-measurer.ts FontkitMeasurer (TextMeasurer for Node)
      dom-polyfill.ts    @xmldom/xmldom shim for DocxImporter's DOMParser usage
    client/
      http-client.ts     REST API v1 wrapper (built-in fetch)
      dry-run.ts         Dry-run request printer
    config/
      config.ts          Config file + env + flag resolution
    output/
      formatter.ts       Format dispatcher (json | table | csv | yaml)
      binary.ts          writeBinary helper for PDF/DOCX exports
      table.ts           Table formatter
      json.ts            JSON formatter
      csv.ts             CSV formatter
    schema/
      registry.ts        Command metadata registry (plural canonical + alias map)
  skills/                Agent skill definitions (Markdown, namespace-prefixed)
    SKILL.md             Skill index and conventions
    sheets-read-cells.md Read cell data from a spreadsheet
    sheets-write-cells.md Write cell data to a spreadsheet
    sheets-import-export.md Import/export CSV and JSON data
    docs-manage.md       Create, list, get, rename, delete documents
    docs-read-content.md Read docs as JSON/Markdown/text (+ --pages)
    docs-export-pdf.md   Export to PDF (+ --pages)
    docs-export-docx.md  Export to .docx
    docs-import-docx.md  Import a .docx (new or --replace)
    recipe-csv-pipeline.md   CSV → spreadsheet → analyze (sheets)
    recipe-data-collect.md   Collect data across spreadsheet documents
    recipe-docx-to-pdf.md    Round-trip a .docx through Wafflebase to PDF
    recipe-doc-to-markdown.md Pull a doc as Markdown for LLM analysis
  scripts/
    gen-sample-docx.mjs  One-shot generator for the integration .docx fixture
```

**package.json** (key fields):

```json
{
  "name": "@wafflebase/cli",
  "version": "0.3.7",
  "bin": { "wafflebase": "./dist/bin.js" },
  "dependencies": {
    "@wafflebase/docs": "workspace:*",
    "@xmldom/xmldom": "^0.9.10",
    "commander": "^13.0.0",
    "fontkit": "^2.0.4",
    "open": "^11.0.0",
    "pdf-lib": "^1.17.1",
    "yaml": "^2.0.0"
  },
  "devDependencies": {
    "vitest": "^3.0.0",
    "typescript": "^5.9.3"
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
pnpm cli dev -- docs list

# After npm publish
npx @wafflebase/cli docs list

# Global install
npm install -g @wafflebase/cli
wafflebase docs list
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
$ wafflebase sheets cells set abc-123 A1 "Revenue" --dry-run
{
  "dry_run": true,
  "method": "PUT",
  "url": "https://api.wafflebase.io/api/v1/workspaces/ws-1/documents/abc-123/tabs/tab-1/cells/A1",
  "body": { "value": "Revenue" }
}
```

##### 7.7.3 Schema Introspection

The `schema` command lets agents discover command parameters and response
shapes at runtime, without consulting external documentation.

```bash
# Show parameters for a command (canonical plural name)
$ wafflebase schema sheets.cells.get
{
  "name": "sheets.cells.get",
  "description": "Get cells from a spreadsheet tab",
  "parameters": {
    "doc-id":  { "type": "string", "required": true, "description": "Document ID" },
    "range":   { "type": "string", "required": false, "description": "Cell range (e.g. A1:C10)", "default": "all" },
    "--tab":   { "type": "string", "required": false, "description": "Tab ID", "default": "tab-1" }
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
  "safety": "read-only",
  "aliases": ["cell.get", "cells.get", "sheet.cells.get", "sheet.cell.get", "sheets.cell.get"]
}

# Singular aliases resolve to the same canonical entry
$ wafflebase schema cell.get      # → sheets.cells.get

# List all available commands
$ wafflebase schema
{
  "commands": [
    { "name": "docs.list",          "safety": "read-only" },
    { "name": "docs.create",        "safety": "write" },
    { "name": "docs.delete",        "safety": "destructive" },
    { "name": "docs.content",       "safety": "read-only" },
    { "name": "docs.export",        "safety": "read-only" },
    { "name": "docs.import",        "safety": "write" },
    { "name": "sheets.cells.get",   "safety": "read-only" },
    { "name": "sheets.cells.set",   "safety": "write" },
    { "name": "sheets.cells.batch", "safety": "write" },
    { "name": "sheets.cells.delete","safety": "destructive" },
    ...
  ]
}
```

`docs.import` exposes a `variants` field that spells out the safety
split — `default → write` (creates a new document), `--replace given →
destructive` (overwrites in place) — so agents know when to ask for
extra confirmation.

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
name: sheets-read-cells
description: Read cell data from a Wafflebase spreadsheet
safety: read-only
tools:
  - wafflebase sheets cells get
  - wafflebase sheets tabs list
---

# Read Cells

## When to Use
When the user wants to read, inspect, or analyze spreadsheet data.

## Commands

### List tabs in a document
\`\`\`bash
wafflebase sheets tabs list <doc-id>
\`\`\`

### Read all cells
\`\`\`bash
wafflebase sheets cells get <doc-id>
\`\`\`

### Read a specific range
\`\`\`bash
wafflebase sheets cells get <doc-id> A1:C10
wafflebase sheets cells get <doc-id> A1:C10 --tab <tab-id>
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
   wafflebase docs create "Q1 Analysis"
   \`\`\`

2. Import CSV data:
   \`\`\`bash
   wafflebase sheets import <doc-id> data.csv
   \`\`\`

3. Add summary formulas:
   \`\`\`bash
   echo '{"E1":"Total","E2":"=SUM(B2:B100)","E3":"Average","E4":"=AVERAGE(B2:B100)"}' \
     | wafflebase sheets cells batch <doc-id>
   \`\`\`

4. Export results:
   \`\`\`bash
   wafflebase sheets export <doc-id> - --file-format csv --range A1:E100
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
| SpreadsheetDocument type duplication (backend) | Keep a backend-local copy. Long-term, move shared types to `@wafflebase/sheets`. CLI already imports directly. |
| CLI requires Node.js runtime | Acceptable for v1 — target users (developers, CI, AI agents) have Node.js. Can produce standalone binary later via `bun build --compile`. |
| CLI and API version drift | CLI includes `version` command; REST API is versioned (`/api/v1/`). CLI checks API compatibility on startup. |
| Skill files become outdated | Keep skills next to the CLI source. CI can validate that skill tool references match real commands. |
| Agents bypassing safety levels | Safety is advisory; the server enforces actual permissions via API key scopes. Safety annotations help agents make better decisions but are not access control. |
