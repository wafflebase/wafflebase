---
title: cli
target-version: 0.3.7
---

# Wafflebase CLI

## Summary

`wafflebase` is a TypeScript CLI that wraps the REST API
([rest-api.md](rest-api.md)) for terminal workflows: data pipelines,
scripting, CSV/JSON import/export, Markdown / PDF / DOCX of Docs
documents, and document management. It ships as `@wafflebase/cli`
inside the pnpm monorepo so it can import `@wafflebase/docs` and
`@wafflebase/sheets` directly and share their types.

Authentication is via browser-based GitHub OAuth (`wafflebase login`),
which stores a JWT session in `~/.wafflebase/session.json`, or via a
workspace-scoped API key (`Authorization: Bearer wfb_...`). Users with
multiple workspaces switch with `wafflebase ctx switch`.

The CLI is designed as a first-class tool for AI agents (Claude Code,
Gemini CLI, Cursor): JSON-by-default output, JSON error envelopes,
`--dry-run`, runtime schema introspection (`wafflebase schema`),
per-command safety annotations, and bundled skill / recipe Markdown
files.

### Goals

- Let users authenticate the CLI by signing in with GitHub in the
  browser; store JWT sessions locally with automatic token refresh.
- Maintain backwards compatibility with API key authentication for
  CI and headless environments.
- Support workspace context switching for users with multiple
  workspaces.
- Provide CRUD-grade access to Docs and Sheets documents from the
  terminal: list, create, get, rename, delete metadata.
- For Sheets: read/write cells, batch updates, CSV/JSON import-export.
- For Docs: read content as JSON/Markdown/text, export to DOCX/PDF,
  import a DOCX as either a new document or a destructive replacement
  of an existing document. Page-based slicing (`--pages 1-3,5`) is a
  first-class concept for content read and PDF export.
- Symmetric plural namespaces (`docs`, `sheets`, `api-keys`) with
  singular aliases for ergonomics.
- Make the CLI first-class for AI agent consumption: structured
  output, self-describing schema, dry-run support, and bundled skill
  definitions.
- Avoid heavy native dependencies (no `node-canvas`-style native
  build) by abstracting text measurement and reusing the existing
  `fontkit` fonts.

### Non-Goals

- Multiple GitHub account switching (single account, multiple
  workspaces).
- Device flow or headless authentication (may be added later).
- Encrypting stored tokens (file permissions are sufficient for now;
  matches `gh`, `supabase` CLIs).
- Block-level write or patch on Docs (`docs blocks set/append/delete`).
  Only whole-document replace via DOCX import is in scope.
- Section/heading-based or block-index-based slicing — only page-based
  slicing is supported in v1.
- Server-side serialization or rendering of Docs. The backend serves
  only raw `Document` JSON; Markdown/text/PDF/DOCX are produced by the
  CLI.
- A separate `waffledocs` binary or a separate npm package for the
  Docs CLI.
- Image upload during DOCX import (v1 imports embed inline images via
  the existing `ImageUploader` interface in `DocxImporter`).
- Real-time streaming or Yorkie-attached read/write from the CLI.

## Proposal Details

### 1. Technology and Distribution

- **Language**: TypeScript (same toolchain as the rest of the
  monorepo).
- **CLI framework**: [commander](https://github.com/tj/commander.js)
  (lightweight, subcommand support).
- **HTTP client**: built-in `fetch` (Node.js 18+).
- **Output formats**: JSON (default), table (`--format table`), CSV
  (`--format csv`), YAML (`--format yaml`).
- **Config file format**: [yaml](https://www.npmjs.com/package/yaml).
- **Distribution**: `npx @wafflebase/cli`, `npm install -g
  @wafflebase/cli`, or `pnpm dlx @wafflebase/cli`.

JSON is the default output format because agents and scripts are the
primary consumers. Human users can switch to `--format table` for
readability.

**Why TypeScript over Go**:

- Shares types with `@wafflebase/sheets` and `@wafflebase/docs` — no
  duplication of `Cell`, `Sref`, `CellStyle`, `SpreadsheetDocument`,
  `Document`, `Block`.
- Single toolchain — no separate Go compiler, linter, or CI pipeline.
- AI agent environments (Claude Code, Cursor) already have Node.js.
- Can be converted to a standalone binary later via `bun build --compile`
  if single-binary distribution becomes important.

### 2. Directory Structure and Configuration

All CLI state lives under `~/.wafflebase/`:

```text
~/.wafflebase/
├── config.yaml        # Profile settings (server, API key, workspace)
└── session.json       # OAuth session (JWT tokens + active workspace)
```

**Migration:** if `~/.wafflebase/config.yaml` does not exist but
`~/.config/wafflebase/config.yaml` does, the CLI copies the file to
`~/.wafflebase/config.yaml` automatically and prints a notice. After
migration, only `~/.wafflebase/` is consulted.

**Config file** (config.yaml) — profiles selected with `--profile`
(default `default`):

```yaml
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

**Session file** (session.json) — written `0600`, owner read/write only:

```json
{
  "server": "http://localhost:3000",
  "user": {
    "id": 1,
    "username": "alice",
    "email": "alice@example.com",
    "photo": "https://avatars.githubusercontent.com/u/..."
  },
  "accessToken": "eyJ...",
  "refreshToken": "eyJ...",
  "expiresAt": "2026-03-15T10:00:00Z",
  "activeWorkspace": "e98ff707-a0e8-473e-88a1-37c0b5bb88da",
  "workspaces": [
    { "id": "e98ff707-...", "name": "hackerwins's Workspace" },
    { "id": "abc-123-...",  "name": "Team Workspace" }
  ]
}
```

`expiresAt` is derived by decoding the JWT payload (base64) and reading
the `exp` claim, converted to ISO 8601.

### 3. Authentication

The CLI supports two authentication paths. OAuth is the default for
developers; API keys are the path for CI and headless environments.

#### 3.1 Login flow (OAuth)

```text
wafflebase login
  │
  ├─ 1. If already logged in → prompt "Logged in as X. Continue? [Y/n]"
  ├─ 2. CLI starts temporary HTTP server on 127.0.0.1:<random-port>
  ├─ 3. Opens browser: GET /auth/github?mode=cli&port=<port>
  │     (also prints URL for copy-paste in headless environments)
  ├─ 4. GitHub OAuth consent screen (existing flow)
  ├─ 5. GitHub redirects to GET /auth/github/callback
  ├─ 6. Backend detects mode=cli in OAuth state →
  │     redirects to http://127.0.0.1:<port>/callback?code=<short-lived-code>
  ├─ 7. CLI local server receives code, calls POST /auth/cli/exchange
  │     with { code } → receives { accessToken, refreshToken }
  ├─ 8. CLI local server serves success HTML, shuts down
  ├─ 9. CLI calls GET /auth/me (Bearer token) for user info
  ├─ 10. CLI calls GET /workspaces (Bearer token) for workspace list
  ├─ 11. Multiple workspaces → interactive selection; single → auto-select
  └─ 12. Writes ~/.wafflebase/session.json
```

The local server binds to `127.0.0.1` only, accepts only `GET
/callback`, and shuts down after a single request with a 30-second
timeout. On timeout it prints: "Login timed out. Try again with
`wafflebase login`."

Tokens are NOT passed as URL query parameters. The short-lived
authorization code is exchanged server-to-server in step 7. CSRF and
port-validation details live in [rest-api.md](rest-api.md) "CLI Auth
Endpoints".

#### 3.2 API keys

Two ways to obtain a key:

**Path A: CLI (developers)**

```bash
wafflebase login                      # OAuth → JWT session
wafflebase api-keys create "CI Key"   # create key using JWT
# Use key in CI: WAFFLEBASE_API_KEY=wfb_xxx
```

**Path B: Web UI (all users)**

```text
1. Sign in at the web app (GitHub OAuth)
2. Navigate to Workspace Settings (/w/:workspaceId/settings)
3. API Keys section → Create → copy the one-time key
4. Use in CLI: wafflebase --api-key wfb_xxx docs list
   Or in config.yaml / environment variable
```

The web UI already supports API key create, list, copy, and revoke
(owner-only, at
`packages/frontend/src/app/workspaces/workspace-settings.tsx`).

#### 3.3 Auth resolution order

When the CLI authenticates a request, it checks sources in this order:

1. **Flag / env:** `--api-key` flag or `WAFFLEBASE_API_KEY` →
   `Authorization: Bearer wfb_...` (API key auth).
2. **Session:** `~/.wafflebase/session.json` exists and token is valid
   → `Authorization: Bearer <jwt>` (JWT auth). If expired, auto-refresh
   via `POST /auth/refresh` with body. If refresh fails, print error
   suggesting `wafflebase login`.
3. **Config profile:** `~/.wafflebase/config.yaml` profile has `api-key`
   → `Authorization: Bearer wfb_...` (API key auth).
4. **None:** error message with `Run "wafflebase login" to authenticate.`

**Workspace resolution:**

1. `--workspace` flag or `WAFFLEBASE_WORKSPACE` env.
2. Session → `activeWorkspace`.
3. Config profile → `workspace`.

#### 3.4 Token refresh

The CLI wraps HTTP requests with automatic refresh:

1. Make request with `Authorization: Bearer <accessToken>`.
2. If 401 response and session exists:
   - Call `POST /auth/refresh` with `{ refreshToken }` in body.
   - On success: update the session file with new tokens, retry
     original request.
   - On failure: print "Session expired. Run `wafflebase login`."
     and exit.
3. At most one refresh attempt per request (no infinite loops).

### 4. Command Tree

Plural namespaces are canonical (`docs`, `sheets`, `api-keys`).
Singular aliases (`doc`, `sheet`, `tab`, `cell`, `api-key`) work
everywhere they're unambiguous.

```text
wafflebase
  ├── login                                  Browser OAuth login → writes session
  ├── logout                                 Clear session
  ├── status                                 Show auth state
  ├── version                                Print CLI version
  ├── schema [<command>]                     Describe command parameters and response shape
  │
  ├── ctx
  │     ├── list                             List workspaces (* = active)
  │     └── switch <name|id>                 Switch active workspace
  │
  ├── api-keys (alias: api-key)
  │     ├── create <name>                    Create a new API key
  │     ├── list                             List API keys in workspace
  │     └── revoke <key-id>                  Revoke an API key
  │
  ├── docs (aliases: doc, document, documents)
  │     ├── list                             [--type doc|sheet]
  │     ├── create <title>                   [--type doc|sheet] (default: sheet)
  │     ├── get <doc-id>                     Show document metadata
  │     ├── rename <doc-id> <title>          Rename a document
  │     ├── delete <doc-id>                  Delete a document
  │     ├── content <doc-id>
  │     │     [--format json|md|text]        (default: json)
  │     │     [--pages <range>]
  │     │     [--include-header-footer]      (default: false)
  │     │     [--inline-images]              (default: false; md only)
  │     │     [--out <file>|-]               (default: stdout)
  │     ├── export <doc-id> <file>
  │     │     [--format docx|pdf]            (default: from extension)
  │     │     [--pages <range>]              (pdf: exact subset; docx: warn+ignore)
  │     │     [--include-header-footer]      (default: true)
  │     │     [--force]                      (overwrite existing file)
  │     └── import <file>
  │           [--title <title>]              (default: file basename)
  │           [--replace <doc-id> --yes]     (destructive; required together)
  │           [--workspace <id>]
  │
  ├── sheets (aliases: sheet, spreadsheet, spreadsheets)
  │     ├── tabs (alias: tab)
  │     │     └── list <doc-id>              List tabs in a spreadsheet
  │     ├── cells (alias: cell)
  │     │     ├── get <doc-id> [<range>]     Get cells (default: all, or A1, or A1:C10)
  │     │     ├── set <doc-id> <ref> <value> [--tab] [--formula]
  │     │     ├── batch <doc-id>             [--tab] [--data <json>]   (JSON from stdin or --data)
  │     │     └── delete <doc-id> <ref>      [--tab]
  │     ├── import <doc-id> <file>
  │     │     [--tab <tab-id>] [--file-format csv|json] [--start <ref>]
  │     └── export <doc-id> <file>
  │           [--tab <tab-id>] [--range A1:C10] [--file-format csv|json]
  │
  ├── slides (aliases: slide, deck)
  │     ├── list                             List slide decks (type: slides)
  │     ├── create <title>                   Create a new deck
  │     ├── get <doc-id>                      Show deck metadata
  │     ├── rename <doc-id> <title>          Rename a deck
  │     ├── delete <doc-id>                   Delete a deck
  │     ├── content <doc-id>
  │     │     [--format json|md|text]        (default: json)
  │     │     [--notes]                       (include speaker notes; md/text)
  │     │     [--out <file>|-]                (default: stdout)
  │     │     [--force]
  │     ├── export <doc-id> <file>
  │     │     [--format pptx]                (default: from extension)
  │     │     [--force]                       (overwrite existing file)
  │     └── import <file>
  │           [--title <title>]               (default: file basename)
  │           [--replace <doc-id> --yes]      (destructive; required together)
  │
  └── notes (alias: note)
        ├── list                             List notes (type: note)
        ├── create <title>                   Create a new note
        ├── get <doc-id>                      Show note metadata
        ├── rename <doc-id> <title>          Rename a note
        ├── delete <doc-id>                   Delete a note
        ├── content <doc-id>
        │     [--format json|md|text]        (default: json)
        │     [--out <file>|-]                (default: stdout)
        │     [--force]
        ├── export <doc-id> <file>
        │     [--format md]                  (default: from extension)
        │     [--force]                       (overwrite existing file)
        └── import <file>
              [--title <title>]               (default: file basename)
              [--replace <doc-id> --yes]      (destructive; required together)
```

The Slides `content` command is text-only for `md`/`text`: it walks each
slide's elements (text boxes, shape labels, table cells, flattened
groups) and serializes the `TextBody` blocks via the same
`@wafflebase/docs` serializers used by `docs content`. Shapes, images,
connectors, positioning, and theming are dropped in those forms; `json`
returns the full `SlidesDocument` losslessly. Slides have no page
concept, so there is no `--pages` flag. PPTX export now ships
(`slides export <doc-id> <file.pptx>`) — it is the inverse of the
importer and achieves a full round-trip via the same OOXML writer, with
three documented v1 limitations: inline href links on text runs,
connector attached-endpoints are not yet wired in the exporter, and
group-targeted animation coupling is a documented v1 gap. PDF
export remains deferred (requires Canvas rasterization).

The Notes commands are the thinnest of the three document namespaces: a
note's entire content *is* a single markdown string held in one Yorkie
`Text` CRDT at `root.content` (byte-compatible with CodePair), so there is
no lossy serialization. `notes content` returns `{ "content": "…" }` for
`--format json` and the raw markdown for `md`/`text`; `notes export`
writes markdown only (a note is already markdown — PDF/HTML export is
deferred). `notes import` reads a `.md` file (or stdin) straight into the
content string. The backend content endpoint dispatches on the persisted
type (`doc` → docs tree, `slides` → slides tree, `note` → `Text`); the
CLI-side `getNoteContent`/`putNoteContent` reuse the same
`GET`/`PUT /documents/:id/content` route.

**Global flags**: `--server`, `--api-key`, `--workspace`, `--profile`,
`--format json|table|csv|yaml` (default: json), `--quiet`, `--verbose`,
`--dry-run`. The `--format` flag also doubles as the per-content shape
on `docs content` (`json|md|text`) and `docs export` (`pdf|docx`);
commander funnels duplicate flag names to the global option, so the
action layer reads `opts.format` and validates against the per-command
vocabulary.

**Page-range syntax**: `1-3`, `2`, `1,3,5`, or `1-3,5,7-9`. Out-of-range
values clamp with a stderr warning; malformed input exits with code
`1`.

**Breaking changes from v0.3.6 → v0.3.7** (no deprecation period; the
old top-level Sheets commands were removed when the symmetric namespace
restructure landed):

| Old                                | New                                       |
| ---------------------------------- | ----------------------------------------- |
| `wafflebase doc …`                 | `wafflebase docs …` (alias `doc`)         |
| `wafflebase tab list …`            | `wafflebase sheets tabs list …`           |
| `wafflebase cell get/set/…`        | `wafflebase sheets cells get/set/…`       |
| `wafflebase import <id> <file>`    | `wafflebase sheets import <id> <file>`    |
| `wafflebase export <id> <file>`    | `wafflebase sheets export <id> <file>`    |
| `wafflebase api-key …`             | `wafflebase api-keys …` (alias `api-key`) |

`docs content` on a sheet document, and `sheets cells …` on a doc-typed
document, both return a type-mismatch error with a pointer to the
correct namespace.

### 5. Usage Examples

```bash
# Login
wafflebase login

# List documents (JSON by default)
wafflebase docs list
wafflebase docs list --type doc           # only word-processor docs
wafflebase docs list --format table       # human-readable table

# Read cells
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
wafflebase docs content abc-123 --format md            # render as Markdown
wafflebase docs content abc-123 --format text --pages 1-3
wafflebase docs export abc-123 out.pdf                 # export to PDF
wafflebase docs export abc-123 out.pdf --pages 1-3     # exact page subset
wafflebase docs export abc-123 out.docx                # export to DOCX
wafflebase docs import draft.docx                      # new doc from .docx
wafflebase docs import revision.docx --replace abc-123 --yes

# Schema introspection (canonical plural names — singular aliases also resolve)
wafflebase schema sheets.cells.get         # show parameters and response shape
wafflebase schema docs.content
wafflebase schema cell.get                 # alias → resolves to sheets.cells.get

# Context switching
wafflebase ctx list                        # list workspaces (* = active)
wafflebase ctx switch "Team Workspace"

# API key management
wafflebase api-keys create "CI Pipeline"
wafflebase api-keys list
wafflebase api-keys revoke key-uuid
```

### 6. Docs Pipeline Internals

The CLI runs serialization, pagination, and DOCX/PDF rendering locally
by importing `@wafflebase/docs`. The backend exposes only raw
`Document` JSON (see [rest-api.md](rest-api.md) §5.4). Pagination is
backend-agnostic via a `TextMeasurer` interface; the CLI ships a
`fontkit`-backed measurer that reuses the fonts already bundled for
PDF export.

#### 6.1 `TextMeasurer` Abstraction in `@wafflebase/docs`

`paginateLayout` and `computeLayout` historically called `ctx.measureText`
on a 2D Canvas. To allow the CLI (Node) to paginate without a native
canvas binding, the layout functions take an injectable measurer:

```ts
// packages/docs/src/view/measurer.ts
export interface ResolvedFont {
  family: string;
  size: number;        // px
  weight: 'normal' | 'bold';
  style: 'normal' | 'italic';
}

export interface TextMeasurer {
  measureWidth(text: string, font: ResolvedFont): number;
  // additional methods factored out of the original Canvas surface
}

// packages/docs/src/view/canvas-measurer.ts (browser default)
export class CanvasTextMeasurer implements TextMeasurer { /* … */ }
```

`paginateLayout(doc, measurer, options)` and `computeLayout(doc,
measurer, options)` accept the measurer as a parameter. All existing
call sites (renderer, editor, PDF exporter, frontend integration, test
fixtures) pass a `CanvasTextMeasurer`. Tests that previously relied on
Canvas mocks use a deterministic stub measurer.

#### 6.2 `FontkitMeasurer` in the CLI

`packages/cli/src/docs/fontkit-measurer.ts` implements `TextMeasurer` by
loading fonts through the existing `PdfFonts` module (already a fontkit
consumer for PDF export). Width is computed as `glyphAdvance ÷
unitsPerEm × size`. A small in-memory font cache is keyed by
`${family}|${weight}|${style}`. NotoKR loaders stay lazy so they only
run when a command actually paginates.

#### 6.3 DOCX Import via Backend Endpoints

The CLI does not depend on the Yorkie SDK. The DOCX import flow is:

```text
default (new document):
  POST /api/v1/.../documents       { title, type: 'doc' }   → returns id
  PUT  /api/v1/.../documents/:id/content  Document JSON

with --replace <doc-id> --yes:
  PUT  /api/v1/.../documents/:doc-id/content  Document JSON
```

`PUT` returns the new `Document` (echo) so the CLI can emit a
confirmation payload in JSON.

#### 6.4 Reference flow

`wafflebase docs content abc-123 --format md --pages 1-3`:

```text
1. CLI: HttpClient.getDocContent("abc-123")
2. Backend: Yorkie attach "doc-abc-123" → return Document JSON
3. CLI: paginateLayout(doc, FontkitMeasurer)
4. CLI: select blocks intersecting pages 1-3 (rule from § 6.6)
5. CLI: blocksToMarkdown(...)
6. CLI: write to stdout (or --out)
```

#### 6.5 Markdown Mapping

| Element                                    | Mapping                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------ |
| title                                      | `#`                                                                      |
| subtitle                                   | `*…*` italic paragraph                                                   |
| heading h1–h6                              | `#` … `######`                                                           |
| paragraph                                  | regular paragraph                                                        |
| list-item ordered                          | `1.` (renderer renumbers)                                                |
| list-item unordered                        | `-`                                                                      |
| nested list                                | 2 spaces of indent per `listLevel`                                       |
| horizontal-rule                            | `---`                                                                    |
| page-break                                 | `<!-- pagebreak -->`                                                     |
| table                                      | GFM table; merges, styles, and nested tables are dropped; first row used as header |
| alignment / indent / line-height           | dropped                                                                  |
| bold                                       | `**text**`                                                               |
| italic                                     | `*text*`                                                                 |
| underline                                  | dropped (no standard Markdown)                                           |
| strikethrough                              | `~~text~~`                                                               |
| color / background / font / size           | dropped                                                                  |
| superscript / subscript                    | dropped                                                                  |
| link                                       | `[text](href)`                                                           |
| image                                      | `![alt](src)`; if `--inline-images=false` (default), `data:` URLs become `[image]` |
| page-number marker                         | literal `#` at its location                                              |
| header / footer                            | included only when `--include-header-footer=true`                        |

The Markdown path emits a one-line stderr notice on first use per
command invocation: "Lossy conversion: see cli.md design for the exact
mapping". Suppressed by `--quiet`.

#### 6.6 Page Slicing Semantics

`--pages 1-3,5` triggers pagination via `paginateLayout(doc,
FontkitMeasurer)` so the CLI knows each block's `lines[].pageIndex`.
Slicing behavior is format-aware:

| Format  | Slicing rule                                                                                          |
| ------- | ----------------------------------------------------------------------------------------------------- |
| `json`  | Include any block whose lines intersect the requested pages. Each block keeps its full `lines[]` metadata so the consumer can re-derive page boundaries. |
| `md`    | Include any block whose lines intersect the requested pages; emit the block whole (no mid-block cut). A block that spans two requested pages appears once. |
| `text`  | Same selection rule as `md`; output is plain text only.                                               |
| `pdf`   | Exact page subset. Implemented by passing the page index list into `PdfExporter`; if that path is not yet supported, fall back to rendering the full PDF and using `pdf-lib` to extract the requested pages. |
| `docx`  | `--pages` triggers a stderr warning ("DOCX has no page concept — exporting full document") and the full document is exported. Exit code 0. |

`--include-header-footer` only affects `md`/`text`; `pdf`/`docx` always
respect their native header/footer regions, and the `json` form always
includes `document.header`/`document.footer` verbatim.

### 7. Project Structure

```text
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
      slides.ts          slides list/create/get/rename/delete + content/export/import
      notes.ts           notes list/create/get/rename/delete + content/export/import
      sheets.ts          Dispatcher: sheets {tabs,cells,import,export}
      tabs.ts            sheets tabs list
      cells.ts           sheets cells get/set/batch/delete
      sheets-import.ts   sheets import CSV/JSON
      sheets-export.ts   sheets export CSV/JSON
      schema.ts          schema introspection
      api-keys.ts        api-keys create/list/revoke
    docs/                Word-processor pipeline
      content.ts         runDocsContent orchestrator (json/md/text + --pages)
      pdf-export.ts      exportPdf via PdfExporter + FontkitMeasurer + pdf-lib slicing
      docx-export.ts     exportDocx wrapper around DocxExporter
      docx-import.ts     importDocx + base64 ImageUploader + InvalidDocxError
      import.ts          runDocsImport orchestrator (POST + PUT, --replace flow)
      paginate.ts        paginateForCli helper (computeLayout + paginateLayout)
    slides/              Presentation pipeline
      content.ts         runSlidesContent orchestrator (json + per-slide md/text)
      import.ts          runSlidesImport orchestrator (POST + PUT, --replace flow)
      pptx-import.ts     importPptx wrapper + base64 image uploader
    notes/               Markdown-note pipeline
      content.ts         runNotesContent orchestrator (json {content} + raw md/text)
      import.ts          runNotesImport orchestrator (POST + PUT, --replace flow)
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
    sheets-read-cells.md / sheets-write-cells.md / sheets-import-export.md
    docs-manage.md / docs-read-content.md / docs-export-pdf.md
    docs-export-docx.md / docs-import-docx.md
    slides-manage.md / slides-read-content.md / slides-export-pptx.md / slides-import-pptx.md
    recipe-csv-pipeline.md / recipe-data-collect.md
    recipe-docx-to-pdf.md / recipe-doc-to-markdown.md
  scripts/
    gen-sample-docx.mjs  One-shot generator for the integration .docx fixture
```

**Root pnpm scripts**:

```json
{
  "cli": "pnpm --filter @wafflebase/cli",
  "cli:dev": "pnpm --filter @wafflebase/cli dev"
}
```

**Development usage**:

```bash
pnpm cli dev -- docs list                # monorepo
npx @wafflebase/cli docs list            # after publish
npm install -g @wafflebase/cli           # global install
```

### 8. Agent Integration

The CLI is designed as a first-class tool for AI agents (Claude Code,
Gemini CLI, Cursor), inspired by the
[Google Workspace CLI](https://github.com/googleworkspace/cli).

#### 8.1 Structured Output

All output is JSON by default. Errors are also JSON so agents can parse
success and failure uniformly:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Document abc-123 not found",
    "command": "docs.content"
  }
}
```

Exit codes: `0` success, `1` user error (bad input, not found),
`2` system error (network, auth). Agents can branch on the exit code
without parsing the error body.

#### 8.2 Dry-Run

`--dry-run` validates inputs, resolves the target API endpoint, and
prints the request that would be sent — without executing it.

```bash
$ wafflebase sheets cells set abc-123 A1 "Revenue" --dry-run
{
  "dry_run": true,
  "method": "PUT",
  "url": "https://api.wafflebase.io/api/v1/workspaces/ws-1/documents/abc-123/tabs/tab-1/cells/A1",
  "body": { "value": "Revenue" }
}
```

Per-command dry-run notes:

- `docs content`, `docs export`: print the GET request that would be issued.
- `docs import` (default): preview both POST (create) and PUT (push content).
- `docs import --replace`: preview the PUT only; `--yes` is ignored.

#### 8.3 Schema Introspection

`wafflebase schema` discovers command parameters and response shapes at
runtime, without consulting external documentation:

```bash
$ wafflebase schema sheets.cells.get
{
  "name": "sheets.cells.get",
  "description": "Get cells from a spreadsheet tab",
  "parameters": {
    "doc-id":  { "type": "string", "required": true,  "description": "Document ID" },
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

$ wafflebase schema cell.get      # → resolves to sheets.cells.get

$ wafflebase schema                # list all commands
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
destructive` (overwrites in place):

```json
{
  "command": "docs.import",
  "safety": "write",
  "variants": [
    { "when": "default",         "safety": "write",       "creates":  "new document" },
    { "when": "--replace given", "safety": "destructive", "modifies": "existing document content" }
  ]
}
```

#### 8.4 Safety Annotations

| Level | Meaning | Agent behavior |
|-------|---------|----------------|
| `read-only` | No side effects | Safe to execute without confirmation |
| `write` | Creates or modifies data | Agent should confirm or use `--dry-run` first |
| `destructive` | Deletes data irreversibly | Agent must ask for user confirmation |

Safety levels are exposed via `wafflebase schema` and embedded in skill
definitions. This aligns with how Claude Code handles tool approval:
read-only tools run freely, write tools require user approval.

Schema entries by command (canonical plural names):

| Command                  | Safety        | Notes                                                  |
| ------------------------ | ------------- | ------------------------------------------------------ |
| `docs.list`              | read-only     | `--type` filter                                        |
| `docs.create`            | write         | `--type` flag                                          |
| `docs.get`               | read-only     | metadata only                                          |
| `docs.rename`            | write         |                                                        |
| `docs.delete`            | destructive   |                                                        |
| `docs.content`           | read-only     |                                                        |
| `docs.export`            | read-only     | file write is local                                    |
| `docs.import`            | write         | `safety` becomes `destructive` with `--replace`        |
| `sheets.tabs.list`       | read-only     |                                                        |
| `sheets.cells.get`       | read-only     |                                                        |
| `sheets.cells.set`       | write         |                                                        |
| `sheets.cells.batch`     | write         |                                                        |
| `sheets.cells.delete`    | destructive   |                                                        |
| `sheets.import`          | write         |                                                        |
| `sheets.export`          | read-only     |                                                        |
| `slides.list`            | read-only     | filtered to `type: slides`                             |
| `slides.create`          | write         |                                                        |
| `slides.get`             | read-only     | metadata only                                          |
| `slides.rename`          | write         |                                                        |
| `slides.delete`          | destructive   |                                                        |
| `slides.content`         | read-only     | `json` lossless; `md`/`text` text-only                 |
| `slides.export`          | read-only     | file write is local; PPTX only                         |
| `slides.import`          | write         | `safety` becomes `destructive` with `--replace`        |
| `notes.list`             | read-only     | filtered to `type: note`                               |
| `notes.create`           | write         |                                                        |
| `notes.get`              | read-only     | metadata only                                          |
| `notes.rename`           | write         |                                                        |
| `notes.delete`           | destructive   |                                                        |
| `notes.content`          | read-only     | `json` → `{content}`; `md`/`text` raw markdown         |
| `notes.export`           | read-only     | file write is local; Markdown only                     |
| `notes.import`           | write         | `safety` becomes `destructive` with `--replace`        |
| `login`                  | write         | OAuth login, writes session file                       |
| `logout`                 | write         | Deletes session file                                   |
| `status`                 | read-only     | Shows current auth state                               |
| `ctx.list`               | read-only     |                                                        |
| `ctx.switch`             | write         | Changes active workspace                               |

#### 8.5 Skills

Skills are Markdown files in `packages/cli/skills/` that serve as
self-contained instruction sets for AI agents. Each skill describes a
focused capability with command syntax, examples, and safety notes.
Agents load the relevant skill file and follow its instructions.

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
`wafflebase sheets tabs list <doc-id>`

### Read all cells
`wafflebase sheets cells get <doc-id>`

### Read a specific range
`wafflebase sheets cells get <doc-id> A1:C10 --tab <tab-id>`

## Safety
read-only — no data is modified. Safe to execute without user
confirmation.
```

#### 8.6 Recipes

Recipes are multi-step workflow templates that compose multiple CLI
commands. They live alongside skills, prefixed with `recipe-`:

```markdown
---
name: recipe-csv-pipeline
description: Import a CSV file, apply formulas, and export results
safety: write
---

1. Create a new document:
   `wafflebase docs create "Q1 Analysis"`
2. Import CSV data:
   `wafflebase sheets import <doc-id> data.csv`
3. Add summary formulas:
   `echo '{"E1":"Total","E2":"=SUM(B2:B100)"}' | wafflebase sheets cells batch <doc-id>`
4. Export results:
   `wafflebase sheets export <doc-id> - --file-format csv --range A1:E100`
```

#### 8.7 Agent Discovery Flow

```text
1. Agent loads skill/recipe files (bundled with CLI or fetched from repo)
2. Reads skill frontmatter to understand safety and available tools
3. Uses `wafflebase schema <command>` to check parameter details
4. For writes, runs with `--dry-run` to show intent to user
5. Executes the command, parses JSON output
6. On error, parses the JSON error response to decide next action
```

No special SDK, MCP server, or API wrapper is needed. The CLI itself
is the agent interface. This approach has key advantages:

- **Zero integration cost**: any agent that can run shell commands works.
- **Self-describing**: `schema` and skill files eliminate documentation lookup.
- **Safe by default**: safety annotations + dry-run prevent accidental data loss.
- **Composable**: recipes show agents how to chain commands for complex tasks.

### 9. Output Conventions

- Text results (json/md/text): stdout by default; `--out` redirects to
  a file. `--quiet` suppresses progress notices but preserves the body.
- Binary results (pdf/docx): positional `<file>`; `-` writes to stdout.
  `--force` is required to overwrite an existing target file. `--quiet`
  suppresses the "Exported to X" notice.
- Errors: a single JSON line on stderr with shape
  `{"error":{"code":"…","message":"…","command":"docs.content"}}`.

### 10. Error Matrix

| Case                                                | Exit | Code                | Message                                                            |
| --------------------------------------------------- | ---- | ------------------- | ------------------------------------------------------------------ |
| `docs.content` on sheet document                    | 1    | TYPE_MISMATCH       | "Use `sheets cells get` for spreadsheet documents"                 |
| `sheets.cells.get` on doc                           | 1    | TYPE_MISMATCH       | "Use `docs content` for document files"                            |
| Malformed `--pages`                                 | 1    | INVALID_RANGE       | "Invalid page range: <input>"                                      |
| `--pages` exceeds page count                        | 0    | (stderr warn)       | "Page range clamped to 1-N"                                        |
| `--pages` with `--format docx`                      | 0    | (stderr warn)       | "DOCX has no page concept — exporting full document"               |
| `--replace` without `--yes` on a TTY                | (interactive prompt) | — | "This will replace content of <doc-id>. Continue? [y/N]"          |
| `--replace` without `--yes` on non-TTY              | 1    | CONFIRMATION_REQ    | "Refusing to overwrite without --yes in non-TTY"                   |
| Output file already exists                          | 1    | FILE_EXISTS         | "Refusing to overwrite <file>; pass --force"                       |
| `--out` / `<file>` directory missing                | 1    | PATH_NOT_FOUND      | (system message)                                                   |
| Backend 401/403                                     | 2    | UNAUTHORIZED        | "Authentication failed. Run `wafflebase login`"                    |
| Backend 5xx or network                              | 2    | SYSTEM              | (original message preserved)                                       |
| Yorkie attach failure                               | 2    | YORKIE_ERROR        | "Failed to attach to document <id>"                                |
| DOCX parse failure                                  | 1    | INVALID_DOCX        | (DocxImporter message)                                             |
| Fontkit font load failure                           | 2    | FONT_LOAD_ERROR     | (after fallback exhausted)                                         |

### 11. Design Principles

- **Stdin/stdout friendly**: support `-` as filename for piping.
- **Scriptable**: JSON output by default for machine consumption,
  `--quiet` to suppress non-essential output, exit codes for success
  (0) and failure (1/2).
- **Progressive disclosure**: simple commands for common tasks, flags
  for advanced options.
- **Offline-safe**: the CLI is stateless beyond local session/config;
  all state lives on the server.

## Risks and Mitigation

| Risk | Mitigation |
|------|-----------|
| CLI requires Node.js runtime | Acceptable for v1 — target users (developers, CI, AI agents) have Node.js. Can produce standalone binary later via `bun build --compile`. |
| CLI and API version drift | CLI includes `version` command; REST API is versioned (`/api/v1/`). CLI checks API compatibility on startup. |
| Skill files become outdated | Keep skills next to the CLI source. CI can validate that skill tool references match real commands. |
| Agents bypassing safety levels | Safety is advisory; the server enforces actual permissions via API key scopes. Safety annotations help agents make better decisions but are not access control. |
| `TextMeasurer` refactor regresses frontend layout | Visual regression run via `pnpm verify:browser:docker`; cross-implementation parity tests between Canvas and Fontkit measurers. |
| Fontkit and Canvas widths diverge enough to shift page break locations | Pixel rounding policy applied uniformly in the measurer adapter; golden tests for breakpoints near page edges. |
| CLI install size grows from `@wafflebase/docs` + fontkit + NotoKR fonts | Keep `PdfFonts` lazy (already lazy today); target ≤ 50 MB for the published CLI tarball. |
| Markdown loss surprises users | One-shot stderr notice per Markdown invocation; documented mapping table in this spec and skills. |
| Renaming top-level `cell/tab/import/export` breaks existing scripts | Document the migration table in the v0.3.7 release notes and the CLI README; expose `wafflebase migrate-help` to print the old → new mapping when an unrecognized command matches a known old name. |
| DOCX with images requires upload pipeline that does not exist yet | v1 imports embed inline images via `DocxImporter`'s `ImageUploader` interface using a base64 inline adapter. Real upload is deferred. |
| Page slicing nondeterminism | `paginateLayout` is deterministic; the only nondeterminism is font substitution, which the measurer warns about. |
| Browser doesn't open (SSH, container) | Print the URL so user can copy-paste. Future: add device flow. |
| Port conflict on localhost | Use random port with retry (up to 3 attempts). |
| Token file readable by other users | `0600` permissions on creation. Print warning if permissions are wrong. |
| Old config path confusion | Auto-copy to `~/.wafflebase/` on first run. Only new path consulted after. |
| Refresh token stolen from disk | Same risk as all file-based CLI token storage. Document in security notes. |
