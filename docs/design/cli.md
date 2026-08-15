---
title: cli
target-version: 0.6.3
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
- For Files: upload any file as a blob document and download its bytes
  back, so a workspace is reachable as a general-purpose store from the
  terminal — not only through the browser's documents list.
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
- Streaming or resumable file upload, and replacing a blob in place
  (`files upload --replace`). Uploads stay buffered under the existing
  50 MB cap; presigned direct-to-S3 remains the documented next step in
  [generic-file-upload.md](generic-file-upload.md).
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
  ├─ 2. CLI starts temporary HTTP server on 127.0.0.1:<random-port>,
  │     bound to a fresh 32-byte nonce it generates
  ├─ 3. Opens browser: GET /auth/github?mode=cli&port=<port>&nonce=<nonce>
  │     (also prints URL for copy-paste in headless environments)
  ├─ 4. GitHub OAuth consent screen (existing flow)
  ├─ 5. GitHub redirects to GET /auth/github/callback
  ├─ 6. Backend detects mode=cli in OAuth state →
  │     redirects to
  │     http://127.0.0.1:<port>/callback?code=<short-lived-code>&nonce=<nonce>
  ├─ 7. CLI local server accepts only a callback echoing that nonce,
  │     then calls POST /auth/cli/exchange
  │     with { code } → receives { accessToken, refreshToken }
  ├─ 8. CLI local server serves success HTML, shuts down
  ├─ 9. CLI calls GET /auth/me (Bearer token) for user info
  ├─ 10. CLI calls GET /workspaces (Bearer token) for workspace list
  ├─ 11. Multiple workspaces → interactive selection; single → auto-select
  └─ 12. Writes ~/.wafflebase/session.json
```

The local server binds to `127.0.0.1` only, accepts only `GET
/callback`, and shuts down once a callback carrying the expected nonce
arrives, with a 30-second timeout. Anything else — an unrelated local
request, or a page that guessed the port — gets `403` and neither
completes nor cancels the pending login (see "Nonce-bound login
callback" in §8.1). On timeout it prints: "Login timed out. Try again
with `wafflebase login`."

A callback that carries **no** nonce is what an older backend redirects
with — and equally what a hostile local page would send, which is why it
is refused by default and why it changes nothing the CLI reports: the
timeout message is the same either way. Because published CLIs and
self-hosted backends upgrade on their own schedules, `wafflebase login
--allow-unbound-callback` accepts it anyway — an explicit, warned
downgrade for that case, never a silent fallback and never something an
unauthenticated request can talk an operator into (see "Nonce-bound
login callback" in §8.1). A *mismatched* nonce stays refused under the
flag: only an attacker sends one.

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
  │     │     ├── list <doc-id>              List tabs in a spreadsheet
  │     │     ├── create <doc-id> [name]     Create a sheet tab (--type sheet)
  │     │     └── rename <doc-id> <tab-id> <name>   Rename a tab
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
  ├── notes (alias: note)
  │     ├── list                             List notes (type: note)
  │     ├── create <title>                   Create a new note
  │     ├── get <doc-id>                      Show note metadata
  │     ├── rename <doc-id> <title>          Rename a note
  │     ├── delete <doc-id>                   Delete a note
  │     ├── content <doc-id>
  │     │     [--format json|md|text]        (default: json)
  │     │     [--out <file>|-]                (default: stdout)
  │     │     [--force]
  │     ├── export <doc-id> <file>|-         (- writes Markdown to stdout)
  │     │     [--format md]                  (default: from extension; - ⇒ md)
  │     │     [--force]                       (overwrite existing file)
  │     └── import <file>
  │           [--title <title>]               (default: file basename)
  │           [--replace <doc-id> --yes]      (destructive; required together)
  │
  └── files (alias: file)
        ├── upload <file>                    Upload any file as a document
        │     [--title <title>]               (default: filename, with ext)
        │     [--folder <id>]                 (default: workspace root)
        ├── download <doc-id> [out]          (out: path, - for stdout;
        │     [--force]                       default: the document filename)
        ├── list                             List blob docs (file/pdf/image)
        │     [--type file|pdf|image]
        ├── get <doc-id>                      Show file document metadata
        ├── rename <doc-id> <title>          Rename a file document
        └── delete <doc-id>                   Delete it and its stored bytes
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

The Files commands are the only namespace with no content model at all: a
`file`/`pdf`/`image` document *is* its stored bytes
([generic-file-upload.md](generic-file-upload.md)), so there is no `content`
command and nothing is ever parsed. Three rules define the namespace:

- **`upload` never parses.** `wafflebase files upload budget.xlsx` stores the
  workbook as bytes; it does not become a spreadsheet. The parseable
  extensions (`.xlsx`, `.docx`, `.pptx`, `.csv`, `.md`) earn a one-line stderr
  hint naming the namespace that *would* parse them, and upload anyway — a CLI
  should do what the command says.
- **…but it does pick the viewer.** The server derives the document type from
  the stored blob id: `.pdf` → `pdf`, `png|jpg|jpeg|gif|webp` → `image`,
  everything else → `file`. Choosing a viewer is not parsing, and a PDF pushed
  from a terminal should open in the PDF viewer exactly like one dropped on the
  documents list. Deriving it from the *stored* id (whose extension has been
  through `safeExtension`) rather than the client's filename means the type can
  never contradict `assertFileIdAllowed`.
- **No stdin.** Every other `import` accepts `-`; `files upload` does not.
  Both the document type and the download extension come from the filename, and
  stdin has none — accepting it would silently produce an untyped, extension-less
  blob.

Upload is a single request (`POST /api/v1/workspaces/:wid/files`, multipart):
the backend stores the blob and creates the document together, deleting the
blob if the document row fails. The browser's queue splits these two steps
because it must survive a reload and resume without orphaning a second blob; a
CLI invocation has no resumable state, so the one-call form is both simpler and
safer. Size caps are checked client-side before the bytes go over the wire
(50 MB, or 25 MB for image extensions), mirroring `packages/backend/src/file/file.constants.ts`.

`files download` writes to the filename the server advertises in
`Content-Disposition` unless a path (or `-`) is given. That header comes from
the derived-not-echoed rule in `packages/backend/src/document/file-response.util.ts`, which the v1 route
reuses, so a `file` document always arrives as an opaque attachment; the CLI
reduces the advertised name to a bare filename before it can reach the
filesystem.

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

# Files (any file, stored as bytes)
wafflebase files upload archive.zip                    # → a `file` document
wafflebase files upload diagram.png --title "Arch v2"  # → an `image` document
wafflebase files upload report.pdf                     # → a `pdf` document
wafflebase files list --type file
wafflebase files download abc-123                      # → ./archive.zip
wafflebase files download abc-123 out/archive.zip --force
wafflebase files download abc-123 - | shasum           # bytes to stdout

# Storing a parseable file as bytes is allowed, and says so:
wafflebase files upload budget.xlsx
# Note: uploading as raw bytes. Use `wafflebase sheets import` to import it
# as an editable document instead.

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

`computeLayout` historically called `ctx.measureText` on a 2D Canvas. To
allow the CLI (Node) to lay out text without a native canvas binding, it
takes an injectable measurer:

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

`computeLayout(blocks, measurer, contentWidth, …)` accepts the measurer
as a parameter; `paginateLayout(layout, pageSetup)` then splits the
already-computed layout into pages and needs no measurer. All existing
call sites (renderer, editor, PDF exporter, frontend integration, test
fixtures) pass a `CanvasTextMeasurer`. Tests that previously relied on
Canvas mocks use a deterministic stub measurer.

#### 6.2 `FontkitMeasurer` in the CLI

`packages/cli/src/docs/fontkit-measurer.ts` implements `TextMeasurer` by
loading fonts through `fontkit` directly (`fontkit.create()`), keeping
its own `register()` method and private `fonts` Map rather than reusing
the PDF exporter's font loader. Width is computed as `advanceWidth ÷
unitsPerEm × size`. The in-memory font cache is keyed by a lowercased
`${family}|${weight}|${style}` variant. NotoKR loaders stay lazy so they
only run when a command actually paginates.

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
3. CLI: computeLayout(blocks, FontkitMeasurer) → paginateLayout(layout, pageSetup)
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

`--pages 1-3,5` triggers pagination via `computeLayout(blocks,
FontkitMeasurer)` followed by `paginateLayout(layout, pageSetup)` so the
CLI knows each block's `lines[].pageIndex`.
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
    bin.ts               Entry point (#!/usr/bin/env node); delegates to cli.ts
    cli.ts               buildProgram() + runCli() (parseAsync + error envelope)
    commands/
      root.ts            Root program, global flags, config loading
      login.ts           login (browser OAuth)
      logout.ts          logout
      status.ts          status
      ctx.ts             ctx list/switch
      docs.ts            docs list/create/get/rename/delete + content/export/import
      slides.ts          slides list/create/get/rename/delete + content/export/import
      notes.ts           notes list/create/get/rename/delete + content/export/import
      files.ts           files upload/download/list/get/rename/delete
      sheets.ts          Dispatcher: sheets {tabs,cells,import,export}
      tabs.ts            sheets tabs list / create / rename
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
      page-range.ts      parsePageRange (1-3,5,7-9 + clamp warnings)
      page-slice.ts      sliceBlocksByPages
      fontkit-measurer.ts FontkitMeasurer (TextMeasurer for Node)
      image-fetcher.ts   Fetch remote/data image bytes for inline embedding
      dom-polyfill.ts    @xmldom/xmldom shim for DocxImporter's DOMParser usage
    slides/              Presentation pipeline
      content.ts         runSlidesContent orchestrator (json + per-slide md/text)
      import.ts          runSlidesImport orchestrator (POST + PUT, --replace flow)
      pptx-export.ts     exportPptx wrapper (inverse of the PPTX importer)
      pptx-import.ts     importPptx wrapper + base64 image uploader
    notes/               Markdown-note pipeline
      content.ts         runNotesContent orchestrator (json {content} + raw md/text)
      import.ts          runNotesImport orchestrator (POST + PUT, --replace flow)
    files/               Blob-document pipeline (no content model)
      upload.ts          runFilesUpload orchestrator (size caps, MIME, parse hint)
      download.ts        runFilesDownload orchestrator + download-target resolution
    client/
      http-client.ts     REST API v1 wrapper (built-in fetch)
      content-disposition.ts  Filename parser for binary responses
      dry-run.ts         Dry-run request printer
    config/
      config.ts          Config file + env + flag resolution
      session.ts         Session file read/write + token refresh
    util/
      csv-parse.ts       CSV parsing helper for sheets import
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
    files-upload-download.md
    recipe-csv-pipeline.md / recipe-data-collect.md
    recipe-docx-to-pdf.md / recipe-doc-to-markdown.md
  scripts/
    gen-sample-docx.mjs  One-shot generator for the integration .docx fixture
    gen-sample-pptx.mjs  One-shot generator for the integration .pptx fixture
    debug-cmd.mjs        Local command-runner helper for manual CLI debugging
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

Argument-parsing failures are part of that contract, not an exception to
it. Commander exits *during parsing*, before any action handler runs, so
its own errors would otherwise print bare prose and skip the envelope —
the one failure an agent driver is most likely to hit. `createProgram()`
sets `exitOverride()` plus a no-op `outputError` output hook so the parse
error reaches `runCli`'s catch as a `CommanderError`, which envelopes it
under the stable code `USAGE`:

```console
$ wafflebase docs content
{
  "error": {
    "code": "USAGE",
    "message": "missing required argument 'doc-id'"
  }
}
```

`--help`, `--version`, and bare `wafflebase` travel the same throw path
(`commander.helpDisplayed` / `commander.version` / `commander.help`) but
have already written their body, so they pass through with their exit code
and no envelope.

Exit codes: `0` success, `1` user error (bad input, not found),
`2` system error (network, auth, server fault). Agents can branch on the
exit code without parsing the error body.

The class is decided where the failure is raised, not sniffed out of the
message text at the output site — `packages/cli/src/errors.ts` holds the
whole contract:

| Failure | `error.code` | Exit |
| --- | --- | --- |
| `fetch` never reached an HTTP server (DNS, refused, TLS) | `NETWORK_ERROR` | `2` |
| HTTP 401 / 403 | `AUTH_ERROR` | `2` |
| HTTP 5xx | `SERVER_ERROR` | `2` |
| A 2xx the CLI cannot use (no `id` on create, a bodyless download) | `INVALID_RESPONSE` / `HTTP_ERROR` | `2` |
| HTTP 400 / 404 / 409, bad flags, type mismatch | command-specific or `ERROR` | `1` |

`SystemError` carries both the `code` that lands in the JSON body and the
`exitCode` that `outputError` applies, so the two can never drift. Every
`fetch` in the CLI goes through `fetchOrThrow` — the one exception is the
image fetcher's `rawRequest`, which drops to undici's low-level `request`
to read a hop the fetch layer opaque-filtered and raises the same
`SystemError('NETWORK_ERROR')` by hand — and the status decides the
class at every non-OK response: `throw httpError(status)` where the CLI
writes the message, and `process.exitCode = exitCodeForStatus(status)` on
the `content`/`export` paths that instead print the backend's own error
envelope verbatim. That second path matters because a `401`
`SESSION_EXPIRED` body is JSON — printing it must not make an expired
session look like bad user input.

`login` prints prose instead of the JSON envelope but reads the same
table: `fetchLoginSession` classifies the exchange / `me` / `workspaces`
responses through `exitCodeForStatus`, so a stale callback code (`400`)
exits `1` while a rejected token or a broken server exits `2`. Anything
not in the contract keeps its stack trace rather than being flattened to
one line.

Error messages carry a redacted URL (`redactUrl`): userinfo from
`--server`/`WAFFLEBASE_SERVER` and presigned query strings from image
URLs never reach stderr or CI logs; scheme, host and path do. The
underlying transport error is scrubbed the same way before it is quoted
— undici echoes the request URL verbatim for some failures, which would
otherwise put back exactly what was just removed. Userinfo is stripped
textually rather than through the URL parser's `username` setter, which
is a no-op for the opaque-path form a scheme-less `--server` produces.

An unparseable URL is the one `fetch` rejection that is *not* a system
error: nothing was ever unreachable, the caller's `--server` was wrong.
It is separated out before the request and exits `1` (`INVALID_URL`).

`--quiet` suppresses the body but not the exit code — scripts branching on
`$?` are the reason the contract exists.

##### Export image fetching

Exports (`docs export`, `slides export`) dereference the image `src`
values found in the document, which are attacker-influenced — anyone who
can edit or share a document picks them. `assertFetchableImageUrl` gates
every one before it is requested, and again on every redirect hop
(redirects are followed by hand, `redirect: 'manual'`, so an allowed host
cannot bounce the CLI onto an internal one):

- only `http:`, `https:` and `data:` are dereferenced, so `file:` cannot
  read local files into the exported artifact;
- address *literals* are checked against loopback / RFC1918 / CGNAT /
  link-local / unique-local, in every spelling — `::ffff:127.0.0.1` and
  `::ffff:7f00:1` are expanded to the same eight words rather than
  matched as text;
- host *names* are only checked against `localhost`, `.localhost`,
  `.internal` and `.local` (a name is not an address: `fc2.com` is a
  public site, not `fc00::/7`), and are then resolved, so a record
  pointing at `169.254.169.254` is refused as well;
- the configured **server** is the one internal destination still
  allowed, because `--server http://localhost:3000` is the normal dev
  setup and self-hosted documents store absolute internal URLs. The
  frontend persists image `src` values absolute, so a dev document says
  `http://localhost:3000/...` while the CLI may be pointed at
  `--server http://127.0.0.1:3000`; comparing origin strings would
  refuse those documents' own images. Three ways to be the server, on
  the same port: the **same name**; **loopback under either spelling**
  (`localhost` / `127.0.0.1` / `::1` / `[::1]` name one listener, and
  the equivalence is between the *names*, so `localhost` answering only
  `::1` still admits the `127.0.0.1` spelling); or an **address
  literal** that is one of the server's resolved addresses.

  A name that is not the server's name is never the server, however it
  resolves. Matching purely on the resolved address — which this did at
  first — hands the document author a name of their own pointed at the
  API server's address on its port, and with it any path there under an
  attacker-chosen `Host`, including a co-located virtual host. An
  address literal keeps the resolved-identity comparison because a
  literal designates one machine and no resolver can steer it.

  Another port on the same host is not covered — the exemption is the
  API server, not the machine.

A blocked `src` fails the export with `IMAGE_URL_BLOCKED` (exit `1` — the
document is wrong, not the environment). A name that cannot be resolved
fails **closed**, as `NETWORK_ERROR` (exit `2`): the gate and the fetch
resolve independently, so allowing an unresolvable name would let a host
whose nameserver stalls the gate's lookup and answers the connect-time
one with `127.0.0.1` straight through.

The verdict is per **address**, not per URL: the configured server's own
addresses are exempt, every other address the host answers with is
judged on its merits, and the request is then **pinned** to the
addresses that passed. Pinning is what makes the gate hold across the
two independent lookups — the CLI depends on `undici` directly and hands
each request an `Agent` whose `connect.lookup` returns the approved
answers, so a rebinding nameserver that answers the gate publicly and
the connect with `169.254.169.254` never gets a connection. It is also
why an address the gate rejected can be dropped rather than failing the
whole URL: it is unreachable either way.

**Egress proxies.** A CLI has no API through which an operator can
install a dispatcher, so the conventional environment variables
(`http_proxy` / `https_proxy` / `all_proxy`, honoring `no_proxy`, either
letter case) *are* the proxy configuration surface. When one applies to
a hop, that hop is dispatched through a `ProxyAgent`. The gate itself is
unchanged — a `src` that resolves to an internal address is refused
before any request is made, proxied or not.

The `Agent`-level pin cannot be combined with a proxy: it works by
overriding the connector's resolver, and the only name a proxied
connector resolves is the proxy's own. Dropping it there would not be
free — the proxy would resolve the image host itself, and its answer is
not the one the gate approved, so a ~0s-TTL nameserver could answer the
gate publicly and the proxy privately and reach an address the gate
refused (the *proxy's* network rather than the CLI's).

So the pin travels with the request instead of being abandoned. The
hop's URL is rewritten to an address the gate approved and *that* is
what the proxy is asked for (`CONNECT 192.0.2.10:443`, or an
absolute-form `GET http://192.0.2.10/…`), while the identity of the
request stays the host the document named: `Host:` for the HTTP request,
and the TLS `servername` (`ProxyAgent`'s `requestTls`) for SNI and
certificate validation. The proxy resolves nothing, so it has no second,
divergent answer to act on. Two consequences: the hop goes out through
undici's low-level `request` rather than `fetch`, because WHATWG `fetch`
forbids setting `Host` and sending the address as the host name would
break every virtual-hosted CDN; and the rewrite applies only to a
name — a `src` that already names an address literal is passed through
unchanged, since it is already the approved address.

The one case where the pin cannot be carried is a proxy that
allow-lists names and refuses `CONNECT` to an address literal. That hop
retries by name, once, and the whole run stops trying the address form
(the proxy has answered that question). This is a property of the
environment rather than of the document, so it is not
attacker-triggerable, and the alternative — failing the export outright
on exactly the machines that can only egress through such a proxy — is
the worse trade. The residual risk after a fallback is the one described
above: the proxy resolves the name, and a rebinding nameserver could
hand it an address the gate refused.

A fallback is not silent. The first hop that gives the pin up writes one
line to stderr saying so and why, naming the hop that triggered it;
every later hop in the same export is silent, because a document with
fifty images states the fact once. A pinned proxied fetch says nothing,
because nothing was given up. The person who set `https_proxy` is the
only one who can judge whether that proxy's resolver is trustworthy, and
this is what puts the question in front of them.

##### Nonce-bound login callback

`wafflebase login` listens on `http://127.0.0.1:<port>/callback`, which
any local process — or any web page that guesses the port — can reach. So
the code alone does not complete a login: the CLI generates a nonce, ships
it as `?nonce=` on the `/auth/github` URL, the backend stores it in the
CLI state and echoes it on the loopback redirect, and the CLI accepts only
a callback whose nonce matches (constant-time compare). Mismatched
requests get `403` and are ignored — they can neither complete nor cancel
the pending login, so a hostile page cannot fix the CLI onto its own
account.

The binding is enforced on the **CLI** side, which is where it works: a
callback that arrives without the expected nonce is refused, and the
login then times out with the same message as any other timeout.

The **backend** half of the same question — did this browser start this
login at all? — is answered by `GitHubAuthGuard`. `/auth/github` refuses
a request whose `Sec-Fetch-Site` says another site navigated the browser
into it (`none` / `same-origin` / `same-site`, or a client that sends no
such header, are served). Without that, a hostile page could start a
`?mode=cli` round trip in the victim's browser with a loopback port of
its choosing, and a code minted from the victim's GitHub session would
be delivered there. The cookies cannot cover this case: the navigation
that carries the attack is the same navigation that would set them.

Both flows then mirror their `state` into a short-lived cookie —
`wafflebase_oauth_state` for the web login, `wafflebase_cli_oauth_state`
for the CLI one, each `__Host-` prefixed wherever the deployment serves
`Secure` cookies — and the callback accepts only a `state` matching the
cookie for its flow, compared in constant time and spent whatever the
outcome. One name per flow so a pending CLI login and a pending web
login in one browser cannot clobber each other. For the CLI that means
a state token seen elsewhere (a shared terminal, a CI log) cannot be
replayed into a victim's browser; the server-side `CliAuthStore` entry
still carries the port and nonce, which a cookie cannot deliver to a
loopback listener.

**The printed OAuth URL is a credential while the login is pending.**
The nonce travels in it, and in the browser's argv, so anything that
captures the CLI's stderr — a shared terminal, an agent transcript, a CI
log — captures the nonce too. What it does *not* leak is remote access:
the callback is `127.0.0.1`, so completing the fixation also requires
reaching the victim machine's loopback within the listener's 30-second
lifetime, i.e. already running code there. The URL is printed regardless
because it is the only fallback when the browser fails to open (`open()`
resolves when the child process spawns, not when a browser appears), so
the CLI says so on the line beneath it rather than printing it silently.

The timeout message is deliberately invariant. An earlier version named
the likely cause ("the server predates nonce-bound CLI login") and
pointed at `--allow-unbound-callback` whenever a nonce-less callback had
arrived — but that listener is reachable by exactly the adversary the
nonce exists to stop, so the diagnostic was attacker-settable. A hostile
page could send one nonce-less `/callback?code=<its own code>`, and the
CLI would then blame the server and prescribe the one flag that turns
the binding off; taking that advice completes a login fixation, since
the replayed callback carries the attacker's code and the victim ends up
holding a session for the attacker's account. A failure diagnostic must
not be steerable by an unauthenticated request, so the cause is no
longer inferred from it.

`wafflebase login --allow-unbound-callback` remains the opt-out that
accepts a nonce-less callback so a current CLI can still log into a
server that has not deployed the echo, documented in `wafflebase login
--help` and the CLI README — places an attacker has no say over. The
flag warns on stderr and covers only the nonce-*absent* case; a
mismatched nonce is still `403`.

`GitHubAuthGuard` rejects a *malformed* nonce (anything but
`[A-Za-z0-9_-]{16,128}`, including a repeated query parameter) with a
`400`, but still serves a request that carries **no** nonce, logging a
warning. That is a deliberate compatibility window, not an oversight:
`@wafflebase/cli` is published to npm, so users run whatever version
they installed, and 400-ing a nonce-less request would break every
released CLI the moment a server deploys. It would also buy nothing —
an attacker minting a code for a loopback port they control simply
supplies a nonce of their own, so requiring one server-side only
guarantees the redirect carries something for a *current* CLI to
compare against, which a current CLI already gets by always sending one.
When published CLIs older than nonce-bound login are out of support, the
guard can turn the warning into a `400`.

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
- `docs import --replace`: preview the PUT only; `--yes` is ignored — the
  destructive-action confirmation is skipped entirely, so the preview also
  works non-interactively. Same for `notes import` / `slides import`.

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
| `sheets.tabs.create`     | write         |                                                        |
| `sheets.tabs.rename`     | write         |                                                        |
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
| `files.upload`           | write         | stores bytes verbatim; never parses                    |
| `files.download`         | read-only     | file write is local                                    |
| `files.list`             | read-only     | filtered to `file`/`pdf`/`image`                       |
| `files.get`              | read-only     | metadata only                                          |
| `files.rename`           | write         |                                                        |
| `files.delete`           | destructive   | deletes the stored blob too                            |
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
  `--quiet` does not suppress it — a non-zero exit with no bytes on
  either stream leaves the caller with nothing to act on. Only progress
  notices are display output; the envelope is the machine-readable
  failure signal, and stderr already survives stdout redirection.

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
| `--replace --dry-run` without `--yes`               | 0    | —                   | (no prompt, no gate — a preview writes nothing)                     |
| Output file already exists                          | 1    | FILE_EXISTS         | "Refusing to overwrite <file>; pass --force"                       |
| `--out` / `<file>` directory missing                | 1    | PATH_NOT_FOUND      | (system message)                                                   |
| Backend 401/403                                     | 2    | AUTH_ERROR          | "Authentication failed. Run `wafflebase login`."                   |
| Backend 5xx                                         | 2    | SERVER_ERROR        | caller's message, else "HTTP <status>"                             |
| Server unreachable (DNS, refused, TLS)              | 2    | NETWORK_ERROR       | "Request to <url> failed: <cause>" (URL + cause redacted)          |
| Unparseable `--server` / image URL                  | 1    | INVALID_URL         | "Invalid URL \"<url>\". Check --server / WAFFLEBASE_SERVER."       |
| Image `src` the CLI refuses to dereference          | 1    | IMAGE_URL_BLOCKED   | "Refusing to fetch …"                                              |
| Create returned 2xx with no `id`                    | 2    | INVALID_RESPONSE    | "Server did not return an id"                                      |
| Download returned 2xx with no bytes                 | 2    | HTTP_ERROR          | (backend body, else `{ error: { code: "HTTP_ERROR" } }`)           |
| Yorkie attach failure                               | 2    | YORKIE_ERROR        | "Failed to attach to document <id>"                                |
| DOCX parse failure                                  | 1    | INVALID_DOCX        | (DocxImporter message)                                             |
| Font CDN unreachable (DNS, refused, TLS)            | 2    | NETWORK_ERROR       | "Request to <url> failed: <cause>"                                 |
| Font download 401/403                               | 2    | AUTH_ERROR          | "Font download failed: <status> …"                                 |
| Font download 5xx                                   | 2    | SERVER_ERROR        | "Font download failed: <status> …"                                 |
| Font download 4xx (e.g. a 404 font URL)             | 1    | —                   | "Font download failed: <status> …"                                 |

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
