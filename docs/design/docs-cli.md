---
title: docs-cli
target-version: 0.4.0
---

<!-- Make sure to append document link in design README.md after creating the document. -->

# Docs CLI Support and Namespace Restructure

## Summary

Extend the existing `wafflebase` CLI so that word-processor documents (Docs)
are first-class alongside spreadsheet documents (Sheets). The CLI gains
metadata, content read, DOCX/PDF export, and DOCX import for Docs, and the
existing Sheets commands move under a `sheets` namespace so the two product
trees are symmetric. Backwards compatibility with the current top-level
Sheets commands is **not** preserved (per stakeholder direction); singular
aliases live inside the new namespaces (`sheets tab list`, `docs doc list`),
not at the old top-level positions.

The CLI runs serialization, pagination, and DOCX/PDF rendering locally by
importing `@wafflebase/docs`. The backend exposes a small read/write content
endpoint pair so the CLI never needs a Yorkie SDK dependency. Pagination is
made backend-agnostic by introducing a `TextMeasurer` interface in
`@wafflebase/docs`; the CLI ships a `fontkit`-backed measurer that reuses the
fonts already bundled for PDF export.

### Goals

- Provide CRUD-grade access to Docs documents from the terminal: list,
  create, get, rename, delete metadata; read content as JSON/Markdown/text;
  export to DOCX/PDF; import a DOCX as either a new document or a destructive
  replacement of an existing document.
- Make page-based slicing a first-class concept for content read and PDF
  export (`--pages 1-3,5`).
- Restructure the CLI command tree so `docs` and `sheets` are sibling
  namespaces and follow consistent conventions (plural namespace names,
  per-resource sub-commands, JSON output by default, schema introspection).
- Keep the CLI agent-friendly: structured JSON output, `--dry-run`,
  `wafflebase schema`, safety annotations, and bundled skill files for
  the new commands.
- Avoid heavy native dependencies (no `node-canvas`-style native build) by
  abstracting text measurement and reusing the existing `fontkit` fonts.

### Non-Goals

- Block-level write or patch (`docs blocks set/append/delete`). Only whole-
  document replace via DOCX import is in scope; granular block edits are
  deferred to a later iteration.
- Section/heading-based or block-index-based slicing. Only page-based
  slicing is supported in v1.
- Server-side serialization or rendering. The backend serves only raw
  `Document` JSON; Markdown/text/PDF/DOCX are produced by the CLI.
- A separate `waffledocs` binary or a separate npm package for the Docs CLI.
- Image upload during DOCX import (deferred — v1 imports embed inline images
  via the existing `ImageUploader` interface in `DocxImporter`).
- Real-time streaming or Yorkie-attached read/write from the CLI.
- Rate limiting or usage metering for the new endpoints.

## Proposal Details

### 1. Architecture and Data Flow

| Layer                       | Responsibility                                                                          |
| --------------------------- | --------------------------------------------------------------------------------------- |
| `@wafflebase/docs` (package) | `Document` model, `paginateLayout`, DOCX/PDF export, DOCX import. **New:** `TextMeasurer` interface plus `CanvasTextMeasurer` (browser default), Markdown/text/JSON serializers, `block.lines[].pageIndex` exposure. |
| `@wafflebase/backend`        | `GET /api/v1/.../documents/:did/content` and `PUT /api/v1/.../documents/:did/content`. Both attach to Yorkie via `YorkieService.withDocument` and (de)serialize the `Document` root. |
| `@wafflebase/cli`            | All Docs commands. Imports `@wafflebase/docs` to run pagination, Markdown/text serialization, DOCX/PDF export, and DOCX import locally. Provides a `fontkit`-based `TextMeasurer`. |
| `fontkit` + bundled NotoKR   | Loaded by `PdfFonts` (already in `@wafflebase/docs`). Reused by the CLI measurer; no extra fonts shipped. |

Reference flow for `wafflebase docs content abc-123 --format md --pages 1-3`:

```
1. CLI: HttpClient.getDocContent("abc-123")
2. Backend: Yorkie attach "doc-abc-123" → return Document JSON
3. CLI: paginateLayout(doc, FontkitMeasurer)
4. CLI: select blocks intersecting pages 1-3 (rule from § 5)
5. CLI: blocksToMarkdown(...)
6. CLI: write to stdout (or --out)
```

The Yorkie key prefix for word-processor documents is `doc-<documentId>`.
The exact prefix used by the frontend MUST be confirmed in step 1 of
implementation; if it differs, the backend service is the only adjustment
point.

### 2. Backend Changes

A single new controller, two endpoints. Both reuse `CombinedAuthGuard` and
`WorkspaceScopeGuard` exactly like the existing `cells.controller.ts`.

```
GET  /api/v1/workspaces/:wid/documents/:did/content
PUT  /api/v1/workspaces/:wid/documents/:did/content
```

- `GET` returns `Document` JSON (block tree, page setup, header/footer,
  inline metadata included as-is).
- `PUT` accepts `Document` JSON and replaces the Yorkie root for the
  document. Marked `safety: write` for non-replace import flows and
  `safety: destructive` when invoked via `--replace --yes`.
- Both reject when the document `type !== 'doc'` with HTTP 409 and a
  message that points to the matching `sheets` command.

Files:

```
packages/backend/src/api/v1/docs-content.controller.ts          (new)
packages/backend/src/api/v1/docs-content.controller.spec.ts     (new)
packages/backend/src/yorkie/yorkie.types.ts                     (re-export Document, Block, Inline, …)
packages/backend/src/api/v1/api-v1.module.ts                    (register controller)
```

No changes to the existing `documents.controller.ts` (metadata),
`tabs.controller.ts`, or `cells.controller.ts`.

### 3. CLI Command Tree

Plural namespaces (`docs`, `sheets`, `api-keys`) with singular aliases at
both the namespace root and inside each namespace (`doc → docs`,
`tab → tabs`, `cell → cells`, `api-key → api-keys`). The canonical form in
help and `schema` output is plural. The previous top-level Sheets commands
(`tab`, `cell`, `import`, `export`) are removed entirely — they live only
under `sheets …` from v0.4.0 onward. No deprecation period; existing scripts
must update.

```
wafflebase
  ├── login
  ├── logout
  ├── status
  ├── version
  ├── schema [<command>]
  │
  ├── ctx
  │     ├── list
  │     └── switch <name|id>
  │
  ├── api-keys (alias: api-key)
  │     ├── create <name>
  │     ├── list
  │     └── revoke <key-id>
  │
  ├── docs (alias: doc, document, documents)
  │     ├── list                                      [--type doc|sheet]
  │     ├── create <title>                            [--type doc|sheet]   (default: sheet)
  │     ├── get <doc-id>
  │     ├── rename <doc-id> <title>
  │     ├── delete <doc-id>
  │     │
  │     ├── content <doc-id>                          (NEW)
  │     │     [--format json|md|text]                 (default: json)
  │     │     [--pages <range>]
  │     │     [--include-header-footer]               (default: false)
  │     │     [--inline-images]                       (default: false; md only)
  │     │     [--out <file>|-]                        (default: stdout)
  │     ├── export <doc-id> <file>                    (NEW)
  │     │     [--format docx|pdf]                     (default: from extension)
  │     │     [--pages <range>]                       (pdf: exact subset; docx: warn+ignore)
  │     │     [--include-header-footer]               (default: true)
  │     │     [--force]                               (overwrite existing file)
  │     └── import <file>                             (NEW)
  │           [--title <title>]                       (default: file basename)
  │           [--replace <doc-id> --yes]              (destructive; required together)
  │           [--workspace <id>]                      (creation only; falls back to global)
  │
  └── sheets (alias: sheet, spreadsheet, spreadsheets)
        ├── tabs (alias: tab)
        │     └── list <doc-id>
        ├── cells (alias: cell)
        │     ├── get <doc-id> [<range>] [--tab <tab-id>]
        │     ├── set <doc-id> <ref> <value> [--tab] [--formula]
        │     ├── batch <doc-id> [--tab] [--data <json>]
        │     └── delete <doc-id> <ref> [--tab]
        ├── import <doc-id> <file>                    (moved from top-level)
        │     [--tab <tab-id>] [--file-format csv|json] [--start <ref>]
        └── export <doc-id> <file>                    (moved from top-level)
              [--tab <tab-id>] [--range A1:C10] [--file-format csv|json]
```

Global flags (unchanged): `--server`, `--api-key`, `--workspace`, `--profile`,
`--format json|table|csv|yaml` (default `json`), `--quiet`, `--verbose`,
`--dry-run`.

Page-range syntax: `1-3`, `2`, `1,3,5`, or `1-3,5,7-9`. Out-of-range values
clamp with a stderr warning; malformed input exits with code `1`.

Breaking changes (from v0.3.x to v0.4.0):

| Old                                | New                                       |
| ---------------------------------- | ----------------------------------------- |
| `wafflebase doc …`                 | `wafflebase docs …` (alias `doc`)         |
| `wafflebase tab list …`            | `wafflebase sheets tabs list …`           |
| `wafflebase cell get/set/…`        | `wafflebase sheets cells get/set/…`       |
| `wafflebase import <id> <file>`    | `wafflebase sheets import <id> <file>`    |
| `wafflebase export <id> <file>`    | `wafflebase sheets export <id> <file>`    |
| `wafflebase api-key …`             | `wafflebase api-keys …` (alias `api-key`) |

`docs content` on a sheet document, and `sheets cells …` on a doc-typed
document, both return a type-mismatch error with a pointer to the correct
namespace.

### 4. CLI Internals and Package Layout

```
packages/cli/
  package.json                    + dependencies: @wafflebase/docs (workspace), fontkit
  src/
    commands/
      docs.ts                     (new) registers list/create/get/rename/delete + content/export/import
      sheets.ts                   (new) namespace wrapper that re-registers cells/tabs/import/export
      cells.ts                    (renamed from cell.ts)
      tabs.ts                     (renamed from tab.ts)
      sheets-import.ts            (renamed from import.ts)
      sheets-export.ts            (renamed from export.ts)
      api-keys.ts                 (renamed from api-key.ts)
      document.ts                 (deleted; absorbed by docs.ts)
      bin.ts                      (registration calls updated)
    client/
      http-client.ts              + getDocContent(docId), putDocContent(docId, document)
      types.ts                    + Document re-export
    docs/
      page-range.ts               parse "1-3,5,7-9" → number[]
      page-slice.ts               format-aware slicing rule (§ 5.2)
      markdown-serializer.ts      Document → Markdown (§ 5.1)
      text-serializer.ts          Document → plain text
      json-serializer.ts          Document → JSON (with optional page-line metadata)
      pdf-export.ts               wraps PdfExporter, handles --pages subset
      docx-export.ts              wraps DocxExporter
      docx-import.ts              wraps DocxImporter, drives create + putDocContent
      fontkit-measurer.ts         TextMeasurer adapter that reuses PdfFonts loaders
    output/
      binary.ts                   (new) PDF/DOCX bytes to stdout/file with --force handling
    schema/
      registry.ts                 + docs.* / sheets.* entries; alias resolution
  skills/
    SKILL.md                                 (index updated)
    sheets-read-cells.md                     (renamed/updated from read-cells.md)
    sheets-write-cells.md                    (renamed/updated)
    sheets-import-export.md                  (renamed/updated)
    recipe-csv-pipeline.md                   (commands updated)
    recipe-data-collect.md                   (commands updated)
    docs-manage.md                           (new)
    docs-read-content.md                     (new)
    docs-export-pdf.md                       (new)
    docs-export-docx.md                      (new)
    docs-import-docx.md                      (new)
    recipe-docx-to-pdf.md                    (new)
    recipe-doc-to-markdown.md                (new)
```

#### 4.1 `TextMeasurer` Abstraction in `@wafflebase/docs`

`paginateLayout` and `computeLayout` currently call `ctx.measureText` on a
2D Canvas. To allow the CLI (Node) to run pagination without a native canvas
binding, we introduce an injectable measurer.

```ts
// packages/docs/src/view/measurer.ts (new)
export interface ResolvedFont {
  family: string;
  size: number;        // px
  weight: 'normal' | 'bold';
  style: 'normal' | 'italic';
}

export interface TextMeasurer {
  measureWidth(text: string, font: ResolvedFont): number;
  // Additional methods may be required as paginateLayout's current Canvas
  // calls are factored through the interface; the implementation step
  // pulls them out one by one.
}

// packages/docs/src/view/canvas-measurer.ts (new, browser default)
export class CanvasTextMeasurer implements TextMeasurer { /* … */ }
```

`paginateLayout(doc, measurer, options)` and `computeLayout(doc, measurer,
options)` change signatures to take the measurer as a parameter. All
existing call sites in `@wafflebase/docs` (renderer, editor, PDF exporter,
test fixtures) and the frontend integration are updated to pass a
`CanvasTextMeasurer`. Tests that previously relied on Canvas mocks are
re-pointed at a deterministic stub measurer.

#### 4.2 `FontkitMeasurer` in the CLI

`packages/cli/src/docs/fontkit-measurer.ts` implements `TextMeasurer` by
loading fonts through the existing `PdfFonts` module (already a fontkit
consumer for PDF export). Width is computed as `glyphAdvance ÷ unitsPerEm ×
size`. A small in-memory font cache is keyed by
`${family}|${weight}|${style}`. NotoKR loaders stay lazy so they only run
when a command actually paginates.

#### 4.3 DOCX Import via Backend Endpoints

The CLI does not depend on the Yorkie SDK. The DOCX import flow is:

```
default (new document):
  POST /api/v1/.../documents       { title, type: 'doc' }   → returns id
  PUT  /api/v1/.../documents/:id/content  Document JSON

with --replace <doc-id> --yes:
  PUT  /api/v1/.../documents/:doc-id/content  Document JSON
```

`PUT` returns the new `Document` (echo) so the CLI can emit a confirmation
payload in JSON.

### 5. Markdown Mapping and Page Slicing

#### 5.1 Markdown Mapping

| Element                                    | Mapping                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------ |
| title                                      | `# `                                                                     |
| subtitle                                   | `*…*` italic paragraph                                                   |
| heading h1–h6                              | `#` … `######`                                                           |
| paragraph                                  | regular paragraph                                                        |
| list-item ordered                          | `1. ` (renderer renumbers)                                               |
| list-item unordered                        | `- `                                                                     |
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

The Markdown path emits a one-line stderr notice on first use per command
invocation: "Lossy conversion: see docs-cli design for the exact mapping".
Suppressed by `--quiet`.

#### 5.2 Page Slicing Semantics

`--pages 1-3,5` triggers pagination via `paginateLayout(doc,
FontkitMeasurer)` so the CLI knows each block's `lines[].pageIndex`. Slicing
behavior is format-aware:

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

### 6. Agent Integration

#### 6.1 Schema Entries

The `wafflebase schema` registry gains the following entries; aliases are
resolved to the canonical plural name.

| Command                  | Safety        | Notes                                                  |
| ------------------------ | ------------- | ------------------------------------------------------ |
| `docs.list`              | read-only     | `--type` filter added                                  |
| `docs.create`            | write         | `--type` flag added                                    |
| `docs.get`               | read-only     | metadata only                                          |
| `docs.rename`            | write         |                                                        |
| `docs.delete`            | destructive   |                                                        |
| `docs.content`           | read-only     | new                                                    |
| `docs.export`            | read-only     | new (file write is local)                              |
| `docs.import`            | write         | new; `safety` becomes `destructive` with `--replace`   |
| `sheets.tabs.list`       | read-only     | renamed                                                |
| `sheets.cells.get`       | read-only     | renamed                                                |
| `sheets.cells.set`       | write         | renamed                                                |
| `sheets.cells.batch`     | write         | renamed                                                |
| `sheets.cells.delete`    | destructive   | renamed                                                |
| `sheets.import`          | write         | renamed                                                |
| `sheets.export`          | read-only     | renamed                                                |

`docs.import` exposes safety variants in its schema entry:

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

#### 6.2 Dry-Run

- `docs.content`, `docs.export`: print the GET request that would be issued.
- `docs.import` (default): preview both POST (create) and PUT (push content).
- `docs.import --replace`: preview the PUT only; `--yes` is ignored.

#### 6.3 Output Conventions

- Text results (json/md/text): stdout by default; `--out` redirects to a
  file. `--quiet` suppresses progress notices but preserves the body.
- Binary results (pdf/docx): positional `<file>`; `-` writes to stdout.
  `--force` is required to overwrite an existing target file. `--quiet`
  suppresses the "Exported to X" notice.
- Errors: a single JSON line on stderr with shape
  `{"error":{"code":"…","message":"…","command":"docs.content"}}`.
- Exit codes: `0` success, `1` user error (bad input, 404, type mismatch),
  `2` system error (network, auth, Yorkie).

#### 6.4 Skills and Recipes

The new skill files (`docs-manage.md`, `docs-read-content.md`,
`docs-export-pdf.md`, `docs-export-docx.md`, `docs-import-docx.md`,
`recipe-docx-to-pdf.md`, `recipe-doc-to-markdown.md`) follow the existing
SKILL.md frontmatter and structure conventions. The Sheets skill files
are renamed and their command examples updated to the new `sheets.*`
namespace.

### 7. Error Matrix

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

A new top-level flag `--force` is added to `docs export` (and any other
command that writes a local file) to permit overwriting.

### 8. Testing Strategy

`@wafflebase/docs`:

- `view/measurer.spec.ts` — `CanvasTextMeasurer` and `FontkitMeasurer`
  agree to within ±1 px on shared font/text fixtures.
- `view/layout.spec.ts` — `paginateLayout` results stay consistent across
  measurer implementations.

`@wafflebase/backend`:

- `api/v1/docs-content.controller.spec.ts` — GET 200/404, type-mismatch
  rejection, `WorkspaceScopeGuard` integration; PUT 200, body validation,
  Yorkie root replacement.

`@wafflebase/cli`:

- `commands/docs.content.spec.ts` — JSON/Markdown/text conversion, `--pages`
  slicing, exit codes (mocked HTTP).
- `commands/docs.export.spec.ts` — PDF/DOCX binary output, PDF page subset,
  stdout streaming.
- `commands/docs.import.spec.ts` — new-doc flow, `--replace --yes` flow,
  TTY guard, dry-run.
- `docs/markdown-serializer.spec.ts` — golden tests covering each row of
  § 5.1.
- `docs/page-range.spec.ts` — syntax parsing goldens.
- `docs/page-slice.spec.ts` — § 5.2 format-aware rule goldens.
- `commands/sheets.spec.ts` — existing cell/tab/import/export tests
  re-pointed at the `sheets.*` namespace (alias coverage included).
- `schema/registry.spec.ts` — new entries, alias resolution.

Integration / E2E:

- `pnpm verify:integration:docker` gains a Docs round-trip scenario:
  start backend + Yorkie, create a doc, `docs import` a fixture DOCX,
  `docs content --format md`, `docs export --format pdf`, assert on
  stable invariants of each output.

### 9. Implementation Order

1. `@wafflebase/docs`: extract `TextMeasurer` interface and
   `CanvasTextMeasurer`; thread it through `paginateLayout` /
   `computeLayout`; update every existing call site (renderer, editor,
   PDF exporter, frontend integration, test fixtures).
2. `@wafflebase/docs`: implement Markdown / text / JSON serializers; expose
   `block.lines[].pageIndex`.
3. Backend: add `docs-content.controller.ts` (GET/PUT), re-export `Document`
   from `yorkie.types.ts`, register in `api-v1.module.ts`, write specs.
4. CLI: rename `cell/tab/import/export/api-key/document` files; introduce
   `docs.ts` and `sheets.ts` namespace registrars; wire aliases.
5. CLI: add `fontkit-measurer.ts` (reusing `PdfFonts`), `page-range.ts`,
   `page-slice.ts`.
6. CLI: implement `docs content` with format dispatch.
7. CLI: implement `docs export` (DOCX + PDF + `--pages` PDF subset).
8. CLI: implement `docs import` (default + `--replace --yes`, TTY guard).
9. CLI: update `schema/registry.ts`; expose `docs.import` variants.
10. CLI: write skills and recipes; refresh `SKILL.md` index.
11. Unit + integration tests; add the Docker integration scenario.
12. Update design docs under `docs/design/` (`docs/`, `sheets/`, and the
    cross-cutting README index) to reflect the new command tree.
13. Bump CLI and backend package versions to v0.4.0.

### Risks and Mitigation

| Risk                                                                    | Mitigation                                                                                                                            |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `TextMeasurer` refactor regresses frontend layout                       | Visual regression run via `pnpm verify:browser:docker`; cross-implementation parity tests between Canvas and Fontkit measurers.       |
| Fontkit and Canvas widths diverge enough to shift page break locations  | Pixel rounding policy applied uniformly in the measurer adapter; golden tests for breakpoints near page edges.                        |
| Yorkie key prefix for word-processor docs differs from `doc-<id>`       | Confirm the frontend convention in implementation step 3; if it differs, change only the backend service constant.                    |
| `PUT /content` race with live collaborators (lost work)                 | `safety: destructive` for the `--replace` path with a forced confirmation. A future iteration may add an optimistic `lastSeq` check.  |
| CLI install size grows from `@wafflebase/docs` + fontkit + NotoKR fonts | Keep `PdfFonts` lazy (already lazy today); target ≤ 50 MB for the published CLI tarball.                                              |
| Markdown loss surprises users                                           | One-shot stderr notice per Markdown invocation; documented mapping table in this spec and skills.                                      |
| Renaming top-level `cell/tab/import/export` breaks existing scripts     | Document the migration table in the v0.4.0 release notes and the CLI README; expose a single `wafflebase migrate-help` hint that prints the old → new mapping when an unrecognised top-level command matches a known old name. |
| DOCX with images requires upload pipeline that does not exist yet       | v1 imports embed inline images via `DocxImporter`'s `ImageUploader` interface using a base64 inline adapter. Real upload is deferred. |
| Page slicing nondeterminism                                             | `paginateLayout` is deterministic; the only nondeterminism is font substitution, which the measurer warns about.                     |
