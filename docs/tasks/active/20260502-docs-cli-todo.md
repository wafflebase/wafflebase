---
title: Docs CLI support and namespace restructure
date: 2026-05-02
status: not-started
target-version: 0.4.0
---

# Docs CLI Implementation Plan

> Use TDD per phase: failing test → minimal impl → green → commit. Keep
> commits frequent (one per coherent unit).

**Goal:** Make Docs (word-processor) first-class in the `wafflebase` CLI —
metadata, content read (JSON/Markdown/text with page slicing), DOCX/PDF
export, DOCX import — and restructure command tree into plural `docs` /
`sheets` / `api-keys` namespaces.

**Design:** [`docs/design/docs-cli.md`](../../design/docs-cli.md)

**Tech Stack:** TypeScript, NestJS (backend), commander (CLI), `@wafflebase/docs`,
fontkit, pdf-lib (already used), Yorkie (backend only). No native canvas dep.

---

## Phase 1 — `TextMeasurer` Abstraction in `@wafflebase/docs`

Goal: lift `ctx.measureText` calls behind an injectable interface so the CLI
can paginate without a Canvas.

- [ ] 1.1 Inventory every `ctx.measureText(...)` call site in
      `packages/docs/src/view/`. Files known to have them:
      `view/layout.ts:26,252,350,352`, `view/doc-canvas.ts`, `view/editor.ts`,
      `view/text-editor.ts`, `view/peer-cursor.ts`, `view/selection.ts`,
      `view/image-selection-overlay.ts`, plus `export/pdf-image-painter.ts`,
      `export/pdf-exporter.ts`. Note which are pagination-critical (layout,
      pdf-exporter) vs. presentation-only (cursor, selection rendering).
- [ ] 1.2 Create `packages/docs/src/view/measurer.ts`:
      ```ts
      export interface ResolvedFont {
        family: string;
        size: number;
        weight: 'normal' | 'bold';
        style: 'normal' | 'italic';
      }
      export interface TextMeasurer {
        measureWidth(text: string, font: ResolvedFont): number;
      }
      ```
- [ ] 1.3 Create `packages/docs/src/view/canvas-measurer.ts` —
      `CanvasTextMeasurer implements TextMeasurer` that wraps an
      `OffscreenCanvas` 2D context. Cache `ctx.font` strings to avoid
      thrashing.
- [ ] 1.4 Add `view/measurer.spec.ts`: golden test asserting
      `CanvasTextMeasurer` returns expected width for a known glyph string
      under a fixed font. Use jsdom or vitest browser env.
- [ ] 1.5 Refactor `view/layout.ts` `computeLayout`/`computeBlockLayout` to
      take `(doc, measurer, options)`. Replace each `ctx.measureText` with
      `measurer.measureWidth(text, resolvedFont)`. Keep `ctx` for paint paths
      that legitimately need Canvas (drawing).
- [ ] 1.6 Refactor `view/pagination.ts` `paginateLayout(doc, measurer,
      options)`. Pass measurer through to `computeLayout`.
- [ ] 1.7 Update `view/editor.ts`, `view/doc-canvas.ts`,
      `export/pdf-exporter.ts` to construct a `CanvasTextMeasurer` once at
      initialization and pass it through. The frontend uses `initialize()`
      and the layout/pagination exports — confirm no frontend call site
      passes its own measurer (it doesn't today). If `initialize()` exposes
      a measurer override, document it but do not require it.
- [ ] 1.8 Update `view/text-editor.ts`, `view/peer-cursor.ts`,
      `view/selection.ts`, `view/image-selection-overlay.ts`,
      `export/pdf-image-painter.ts` to use the measurer where width matters,
      keep raw `ctx.measureText` only inside paint code that already owns a
      `ctx`.
- [ ] 1.9 Update existing tests:
      `test/view/layout.test.ts`, `test/view/pagination.test.ts`,
      `test/view/incremental-layout.test.ts`, `test/view/table-origin-y.test.ts`,
      `test/view/table-row-split.test.ts`, `test/export/pdf-exporter.test.ts`,
      `test/export/pdf-painter.test.ts` to use a deterministic stub measurer
      (e.g., `new StubMeasurer(charWidth = 8)`) instead of relying on jsdom's
      missing `getContext('2d')`. This eliminates the
      "Not implemented: HTMLCanvasElement's getContext()" warnings.
- [ ] 1.10 Export `TextMeasurer`, `ResolvedFont`, `CanvasTextMeasurer` from
      `packages/docs/src/index.ts`.
- [ ] 1.11 Run `pnpm --filter @wafflebase/docs test` and
      `pnpm verify:fast` — all green.
- [ ] 1.12 Commit: `Refactor pagination behind TextMeasurer interface`.

## Phase 2 — Serializers and Page-Line Metadata

- [ ] 2.1 Modify `view/pagination.ts` so each `LayoutLine` exposes its
      `pageIndex` (already implicit via `LayoutPage[]`; surface a flat
      `paginatedLayout.lines: Array<{ blockId, lineIndex, pageIndex }>` or
      add `pageIndex` to `LayoutLine` directly). Update consumers minimally.
- [ ] 2.2 Create `packages/docs/src/serialize/markdown.ts` —
      `serializeMarkdown(doc: Document, opts: MarkdownOptions): string`.
      Implement the mapping table from design § 5.1 row-by-row. Options:
      `{ inlineImages?: boolean; includeHeaderFooter?: boolean }`.
- [ ] 2.3 Add `test/serialize/markdown.test.ts`. One golden case per row of
      the mapping table (title, subtitle, headings 1–6, paragraph, ordered
      list, unordered list, nested list, hr, page-break, GFM table, bold,
      italic, strike, link, image inline + placeholder, page-number marker,
      header/footer toggle, dropped properties).
- [ ] 2.4 Create `packages/docs/src/serialize/text.ts` —
      `serializeText(doc, opts)`. Strip all formatting; one block per line.
      Options: `{ includeHeaderFooter?: boolean }`.
- [ ] 2.5 Add `test/serialize/text.test.ts` with goldens for paragraphs,
      lists (markers stripped), tables (cells joined by tabs).
- [ ] 2.6 Create `packages/docs/src/serialize/json.ts` —
      `serializeJson(doc, paginatedLayout?)`: returns `Document` plus an
      optional `_pageMeta: { blockId, lines: number[] }[]` when a paginated
      layout is supplied.
- [ ] 2.7 Add `test/serialize/json.test.ts`. With layout, verify
      `_pageMeta` is well-formed; without layout, verify it's absent.
- [ ] 2.8 Export the three serializers from `packages/docs/src/index.ts`.
- [ ] 2.9 Run `pnpm --filter @wafflebase/docs test`. Commit:
      `Add Markdown/text/JSON serializers and page-line metadata`.

## Phase 3 — Backend Content Endpoints

- [x] 3.1 Confirm Yorkie key prefix for word-processor docs by reading
      frontend `packages/frontend/src/...` (search for `attach`/`'doc-'`).
      If different from `doc-<id>`, note the actual prefix and align the
      backend constant.
      → Confirmed `doc-<id>` (frontend `app/docs/docs-detail.tsx:210`,
      `app/shared/shared-document.tsx:188`). The existing
      `YorkieService.withDocument` hardcoded `sheet-<id>`, so the backend
      had no way to reach docs documents. Added an optional
      `docKeyPrefix` option (default `'sheet-'`) so docs callers pass
      `'doc-'` and existing sheets callers stay unchanged.
- [x] 3.2 Update `packages/backend/src/yorkie/yorkie.types.ts` to also
      `export type { Document, Block, Inline, ... } from '@wafflebase/docs'`.
      → Re-exported as `DocsDocument`, `DocsBlock`, `DocsInline`, plus
      `DocsBlockStyle`, `DocsInlineStyle`, `DocsHeaderFooter`,
      `DocsPageSetup`, `DocsTableRow`, `DocsTableCell`. Added
      `@wafflebase/docs: workspace:^` to backend deps and matching path
      mappings in `tsconfig.json`, the in-package Jest config, and
      `test/jest-e2e.json`.
- [x] 3.3 Create `packages/backend/src/api/v1/docs-content.controller.ts`:
      ```ts
      @Controller('api/v1/workspaces/:workspaceId/documents/:documentId/content')
      @UseGuards(CombinedAuthGuard, WorkspaceScopeGuard)
      export class ApiV1DocsContentController {
        constructor(
          private readonly documentService: DocumentService,
          private readonly yorkie: YorkieService,
        ) {}

        @Get()
        async get(@Param('workspaceId') wid, @Param('documentId') did) {
          const meta = await this.documentService.getDocumentOrThrow({ id: did, workspaceId: wid });
          if (meta.type !== 'doc') throw new ConflictException(/* see 3.4 */);
          return this.yorkie.withDocument(`doc-${did}`, (d) => d.getRoot()); // returns Document JSON
        }

        @Put()
        async put(@Param() params, @Body() body: Document) {
          const meta = await this.documentService.getDocumentOrThrow({ id: params.documentId, workspaceId: params.workspaceId });
          if (meta.type !== 'doc') throw new ConflictException(/* see 3.4 */);
          return this.yorkie.withDocument(`doc-${params.documentId}`, (d) => {
            d.update((root) => { /* replace root with body */ });
            return d.getRoot();
          });
        }
      }
      ```
- [x] 3.4 Type-mismatch error body:
      `{ error: { code: 'TYPE_MISMATCH', message: "Use 'sheets cells get' for spreadsheet documents" } }`
      for GET; mirror for PUT. Use the matching `sheets …` hint string.
      → Implemented as `TYPE_MISMATCH_BODY` in
      `docs-content.controller.ts` and passed verbatim to NestJS'
      `ConflictException(response)` for both GET and PUT. No global
      exception filter rewrites the body, so the `error.code` /
      `error.message` keys survive untouched.
- [x] 3.5 Register the controller in
      `packages/backend/src/api/v1/api-v1.module.ts` (add to `controllers`).
      → Added `ApiV1DocsContentController` to the module's `controllers`
      array. `YorkieService` is provided by the `@Global()` `YorkieModule`
      and `DocumentService` is already in the v1 module's `providers`,
      so no additional wiring needed.
- [x] 3.6 Add `packages/backend/src/api/v1/docs-content.controller.spec.ts`:
      - GET 200 returns Document JSON
      - GET 404 when document not found
      - GET 409 with `TYPE_MISMATCH` when `type === 'sheet'`
      - PUT 200 round-trips body unchanged via Yorkie
      - PUT 409 when `type === 'sheet'`
      - WorkspaceScopeGuard rejects mismatched workspace
      → All five controller-domain cases land in
      `docs-content.controller.spec.ts`. The guard is overridden in the
      test module since `WorkspaceScopeGuard` has its own dedicated
      spec. Added a separate `yorkie/docs-tree.spec.ts` that exercises
      `writeDocsRoot`/`readDocsRoot` against a real offline Yorkie
      `Document` to cover the writer/reader's correctness.
- [x] 3.7 Run `pnpm --filter @wafflebase/backend test` and `pnpm verify:fast`.
      → Backend: 13 suites / 117 tests pass. `verify:fast`: green.
- [x] 3.8 Commit: `Add docs content GET/PUT endpoints`.

## Phase 4 — CLI Namespace Restructure (Sheets move under `sheets …`)

- [x] 4.1 Rename files:
      - `packages/cli/src/commands/cell.ts` → `cells.ts`
      - `packages/cli/src/commands/tab.ts` → `tabs.ts`
      - `packages/cli/src/commands/import.ts` → `sheets-import.ts`
      - `packages/cli/src/commands/export.ts` → `sheets-export.ts`
      - `packages/cli/src/commands/api-key.ts` → `api-keys.ts`
- [x] 4.2 Inside each renamed file, change the `program.command(...)` call
      to expect a parent `Command` (the namespace root) and rename the
      registration function:
      - `registerCellCommand(program)` → `registerCellsCommand(sheetsCmd)`
      - `registerTabCommand(program)` → `registerTabsCommand(sheetsCmd)`
      - `registerImportCommand(program)` → `registerSheetsImportCommand(sheetsCmd)`
      - `registerExportCommand(program)` → `registerSheetsExportCommand(sheetsCmd)`
      - `registerApiKeyCommand(program)` → `registerApiKeysCommand(program)`
- [x] 4.3 Add `.alias()` calls on each subcommand:
      `tabs (alias: tab)`, `cells (alias: cell)`,
      `api-keys (alias: api-key)`.
- [x] 4.4 Create `packages/cli/src/commands/sheets.ts`:
      ```ts
      import { Command } from 'commander';
      import { registerCellsCommand } from './cells.js';
      import { registerTabsCommand } from './tabs.js';
      import { registerSheetsImportCommand } from './sheets-import.js';
      import { registerSheetsExportCommand } from './sheets-export.js';

      export function registerSheetsCommand(program: Command) {
        const sheets = program
          .command('sheets')
          .alias('sheet').alias('spreadsheet').alias('spreadsheets')
          .description('Spreadsheet commands');
        registerTabsCommand(sheets);
        registerCellsCommand(sheets);
        registerSheetsImportCommand(sheets);
        registerSheetsExportCommand(sheets);
        return sheets;
      }
      ```
- [x] 4.5 Rename `commands/document.ts` → `commands/docs.ts`:
      - Change `program.command('document').alias('doc')` to
        `program.command('docs').alias('doc').alias('document').alias('documents')`.
      - Add `--type doc|sheet` to `list` and `create`. `create` defaults to
        `sheet` (preserves existing CLI behavior). `create` POST body now
        includes `{ title, type }`.
- [x] 4.6 Update `packages/cli/src/bin.ts`:
      - Replace `registerDocumentCommand(program)` with
        `registerDocsCommand(program)`.
      - Replace `registerCellCommand`, `registerTabCommand`,
        `registerImportCommand`, `registerExportCommand` with a single
        `registerSheetsCommand(program)`.
      - `registerApiKeyCommand` → `registerApiKeysCommand`.
- [x] 4.7 Update existing tests/test files for the rename. Verify aliases:
      - `wafflebase doc list` still works (alias `doc → docs`)
      - `wafflebase sheets cell get …` works (alias `cell → cells`)
      - `wafflebase tab list …` (top-level) is now an unknown command (intended)
      → Added `test/namespaces.test.ts` covering top-level structure,
      docs/sheets/api-keys aliases, sheets sub-commands, removal of
      legacy top-level commands, and `--type` options on `docs
      list`/`create`.
- [x] 4.8 Run `pnpm --filter @wafflebase/cli test` and `pnpm verify:fast`.
      → CLI tests: 8 files / 68 tests pass. `verify:fast`: 44 files / 737
      tests pass.
- [ ] 4.9 Commit: `Restructure CLI into docs/sheets/api-keys namespaces`.

## Phase 5 — CLI Fontkit Measurer and Page Utilities

- [x] 5.1 Add `fontkit` to `packages/cli/package.json` `dependencies` and
      `@wafflebase/docs` as `workspace:*`. Run `pnpm install`.
- [x] 5.2 Create `packages/cli/src/docs/fontkit-measurer.ts`:
      ```ts
      import fontkit from 'fontkit';
      import type { TextMeasurer, ResolvedFont } from '@wafflebase/docs';
      // Reuse PdfFonts loaders to obtain Buffer for each (family, weight, style).
      export class FontkitMeasurer implements TextMeasurer { /* … */ }
      ```
      Key impl: glyph advance ÷ unitsPerEm × size, with an LRU
      `${family}|${weight}|${style}` font cache. Lazy-load NotoKR by calling
      the existing `PdfFonts` helper.
- [x] 5.3 Add `test/fontkit-measurer.spec.ts`. Use a fixed font fixture
      (e.g., one of the PdfFonts NotoKR variants) and assert width within
      ±1 px of an oracle Canvas measurement captured offline.
      → Reused `packages/docs/test/export/fixtures/fonts/test-cjk.ttf`.
      Assertions use exact font-unit math (29.472 px for 'Hello' @ 12px,
      30.72 px for '한글' @ 16px).
- [x] 5.4 Create `packages/cli/src/docs/page-range.ts`:
      ```ts
      export interface PageRange { pages: ReadonlySet<number> }
      export function parsePageRange(input: string, totalPages: number): PageRange;
      ```
      Accept `"1-3,5,7-9"`, `"2"`, `"1,3,5"`, `"1-3,5,7-9"`. Throw on
      malformed (`"0"`, `"3-1"`, `"abc"`). Clamp upper bound to `totalPages`
      with a stderr warning message returned alongside.
- [x] 5.5 Add `test/page-range.spec.ts` covering: simple range, single page,
      mixed, malformed (each → throws), clamp (returns warning + clamped
      set).
      → 14 tests in `test/page-range.test.ts` covering single, range,
      mixed, dedupe, clamp, drop-out-of-range, 0-page rejection,
      reversed range, non-numeric, empty, empty-token, zero-totalPages.
- [x] 5.6 Create `packages/cli/src/docs/page-slice.ts`:
      ```ts
      export type SliceFormat = 'json' | 'md' | 'text';
      export function sliceBlocksByPages(
        doc: Document,
        layout: PaginatedLayout,
        range: PageRange,
        format: SliceFormat,
      ): { blocks: Block[]; pageMeta?: PageMeta };
      ```
      `PageRange` is the type returned by `parsePageRange` (Phase 5.4).
      Per § 5.2 of the design: include any block whose lines intersect the
      requested pages; for `json`, attach `pageMeta`; for `md`/`text`, no
      meta.
- [x] 5.7 Add `test/page-slice.spec.ts` with fixture document spanning 3
      pages: assert `--pages 1-2` selection by format, assert spanning
      blocks appear once.
      → 8 tests in `test/page-slice.test.ts` against a 4-block / 3-page
      fixture: includes spanning blocks once, preserves order across
      multi-page selections, attaches `pageMeta` only for json, drops
      ghost blocks with no layout lines.
- [ ] 5.8 Run `pnpm --filter @wafflebase/cli test`. Commit:
      `Add fontkit measurer and page-range/page-slice utilities`.
      → CLI tests: 11 files / 96 tests pass. `verify:fast`: 44 files /
      737 tests pass.

## Phase 6 — `wafflebase docs content`

- [x] 6.1 Add to `packages/cli/src/client/http-client.ts`:
      ```ts
      async getDocContent(docId: string): Promise<HttpResponse<Document>> {
        return this.get(`/api/v1/workspaces/${this.workspace}/documents/${docId}/content`);
      }
      ```
      Re-export `Document` from `client/types.ts`.
      → Added `getDocContent(docId)` to `HttpClient` returning
      `ApiResponse<Document>`. `Document` is imported directly from
      `@wafflebase/docs` (no separate `client/types.ts` indirection).
- [x] 6.2 Implement `docs content` in `packages/cli/src/commands/docs.ts`.
      → Command lives in `docs.ts`; the orchestration moved to
      `docs/content.ts` (`runDocsContent`) so it can be unit-tested
      without spawning the CLI. The action passes the fetched doc into
      that helper. Pagination uses the Phase 5 `FontkitMeasurer`
      fallback (no fonts pre-loaded yet); page counts are approximate
      but the slicer is correct.
- [x] 6.3 Add tests `test/commands/docs-content.test.ts` (mocked HTTP):
      → 20 tests in `test/docs-content.test.ts` covering json/md/text
      output, lossy notice + quiet suppression, `--pages` selection +
      `_pageMeta` attachment + clamp warnings + malformed input,
      `--out` (file write through IO surface, stdout `-`, force flag,
      refuse-to-overwrite default). `TYPE_MISMATCH` passthrough is
      validated at the http-client layer with a mocked `fetch`.
- [x] 6.4 Run `pnpm --filter @wafflebase/cli test`. Commit:
      `Add docs content command`.
      → CLI tests: 12 files / 116 tests pass. `verify:fast`: green
      across frontend (1236), cli (116), docs (737).

## Phase 7 — `wafflebase docs export`

- [ ] 7.1 Create `packages/cli/src/docs/pdf-export.ts`:
      `exportPdf(doc: Document, opts: { pages?: PageRange; includeHeaderFooter?: boolean }): Promise<Uint8Array>`.
      Strategy: use `PdfExporter` (from `@wafflebase/docs`) to render full
      PDF, then if `pages` is set, post-process with `pdf-lib` to extract
      requested pages. (If `PdfExporter` later gains a `pages` option, pass
      through and skip post-processing.)
- [ ] 7.2 Create `packages/cli/src/docs/docx-export.ts`:
      `exportDocx(doc, { includeHeaderFooter? }): Promise<Uint8Array>`. Wraps
      `DocxExporter`. If caller passed `--pages`, emit stderr warning and
      ignore.
- [ ] 7.3 Create `packages/cli/src/output/binary.ts`:
      `writeBinary(bytes: Uint8Array, target: string | '-', { force, quiet })`.
      Refuses to overwrite existing files unless `force`; writes to
      `process.stdout` when target is `-`.
- [ ] 7.4 Implement `docs export <doc-id> <file>` in `commands/docs.ts`.
      Flags: `--format docx|pdf` (default from extension), `--pages <range>`,
      `--include-header-footer` (default `true`), `--force`.
      Behavior:
      1. Fetch via `getDocContent`.
      2. Dispatch by format → `exportDocx` or `exportPdf`.
      3. `writeBinary` to target.
- [ ] 7.5 Add tests `test/commands/docs-export.test.ts` (mocked HTTP):
      - PDF export to file produces a non-empty Uint8Array starting with
        `%PDF-` header
      - PDF export with `--pages 1` extracts first page only (assert page
        count via `pdf-lib` reload)
      - DOCX export to file produces a non-empty zip-like buffer (PK header)
      - DOCX export with `--pages` emits stderr warning, exit 0
      - Refuse-to-overwrite path returns exit 1 unless `--force`
      - Output `-` writes to `process.stdout`
- [ ] 7.6 Run tests; commit: `Add docs export command (DOCX/PDF + --pages)`.

## Phase 8 — `wafflebase docs import`

- [ ] 8.1 Add to `http-client.ts`:
      ```ts
      async putDocContent(docId: string, doc: Document): Promise<HttpResponse<Document>> {
        return this.put(`/api/v1/workspaces/${this.workspace}/documents/${docId}/content`, doc);
      }
      ```
- [ ] 8.2 Create `packages/cli/src/docs/docx-import.ts`:
      `importDocx(buf: Uint8Array): Promise<Document>` via `DocxImporter`
      with an inline-base64 `ImageUploader` adapter (no external upload yet).
- [ ] 8.3 Implement `docs import <file>` in `commands/docs.ts`.
      Flags: `--title <title>` (default basename without extension),
      `--replace <doc-id>`, `--yes`, `--workspace <id>`.
      Behavior:
      - Default: `POST /documents { title, type: 'doc' }` then
        `PUT .../content`. Output `{ id, title }` JSON.
      - With `--replace <id>`:
        - On TTY without `--yes`: interactive prompt
          `"This will replace content of <id>. Continue? [y/N]"`. Decline →
          exit 0, no changes.
        - On non-TTY without `--yes`: exit 1 with `CONFIRMATION_REQ`.
        - With `--yes`: skip prompt, `PUT .../content`.
      - File `-` reads from `process.stdin`.
- [ ] 8.4 Add tests `test/commands/docs-import.test.ts`:
      - New-doc flow: mocks `POST /documents` and `PUT .../content`,
        asserts both calls fire with expected payloads
      - `--replace --yes` flow: only PUT fires, no POST
      - `--replace` non-TTY without `--yes`: exit 1 + `CONFIRMATION_REQ`
      - `--replace` TTY without `--yes` declined: exit 0, no PUT
      - `--dry-run` with `--replace`: prints PUT preview, makes no requests
      - File `-` reads stdin; `--title` default uses basename
      - Invalid DOCX fixture → exit 1 + `INVALID_DOCX`
- [ ] 8.5 Run tests; commit: `Add docs import command (new doc + --replace --yes)`.

## Phase 9 — Schema, Skills, Recipes

- [ ] 9.1 Update `packages/cli/src/schema/registry.ts` to add the new
      entries from design § 6.1 with `safety` levels. Ensure aliases resolve
      to canonical plural names. Implement `docs.import` `variants` field
      from the design example.
- [ ] 9.2 Add `test/schema-registry.test.ts` cases:
      `wafflebase schema docs.content` returns expected shape;
      `wafflebase schema doc.content` (alias) resolves to same;
      listing returns the union of new docs and renamed sheets entries.
- [ ] 9.3 Rename and update existing skills:
      - `skills/read-cells.md` → `skills/sheets-read-cells.md` (commands
        updated to `sheets cells get`)
      - `skills/write-cells.md` → `skills/sheets-write-cells.md`
      - `skills/import-export.md` → `skills/sheets-import-export.md`
      - `skills/recipe-csv-pipeline.md` and `skills/recipe-data-collect.md`:
        update commands.
- [ ] 9.4 Create new skills (each follows existing frontmatter convention):
      - `skills/docs-manage.md` — `docs list/create/get/rename/delete`
      - `skills/docs-read-content.md` — `docs content` with json/md/text +
        `--pages`
      - `skills/docs-export-pdf.md` — `docs export` to PDF + `--pages`
      - `skills/docs-export-docx.md` — `docs export` to DOCX
      - `skills/docs-import-docx.md` — `docs import` (new + `--replace --yes`)
- [ ] 9.5 Create recipes:
      - `skills/recipe-docx-to-pdf.md` — `import` then `export --format pdf`
      - `skills/recipe-doc-to-markdown.md` — `content --format md` chained
        to LLM analysis
- [ ] 9.6 Update `skills/SKILL.md` index to list all new and renamed files.
- [ ] 9.7 Commit: `Add schema entries and skill/recipe files for docs CLI`.

## Phase 10 — Integration Scenario

- [ ] 10.1 Add a Docs round-trip scenario to the existing
      `pnpm verify:integration:docker` lane:
      1. Spin up backend + Yorkie.
      2. Create a workspace + API key.
      3. `wafflebase docs import fixtures/sample.docx --title 'IT'`
      4. Capture returned doc-id.
      5. `wafflebase docs content <id> --format md` — assert non-empty,
         contains expected heading text.
      6. `wafflebase docs export <id> /tmp/out.pdf` — assert file exists and
         starts with `%PDF-`.
      7. `wafflebase docs export <id> /tmp/out.docx` — assert PK header.
      8. `wafflebase docs import /tmp/out.docx --replace <id> --yes` —
         assert second `content --format md` matches first.
- [ ] 10.2 Commit: `Add docs CLI integration scenario`.

## Phase 11 — Design / Docs / Version

- [ ] 11.1 Update existing design docs that reference the old top-level
      Sheets commands:
      - `docs/design/rest-api-and-cli.md` — § 7.3 command tree, § 7.4
        examples (rewrite under `sheets …`).
      - `docs/design/sheets/sheet.md` — any CLI examples.
- [ ] 11.2 Add a brief link from `docs/design/docs/docs.md` to
      `docs/design/docs-cli.md` so Docs design readers can find the CLI
      surface.
- [ ] 11.3 Bump versions:
      - `package.json` (root) → `0.4.0`
      - `packages/cli/package.json` → `0.4.0`
      - `packages/backend/package.json` → `0.4.0`
      - `packages/docs/package.json` → `0.4.0` (TextMeasurer signature
        change is a minor breaking change)
      - `packages/frontend/package.json` → `0.4.0`
- [ ] 11.4 Update CLI README with the new namespace tree (new file or
      existing — match repo convention).
- [ ] 11.5 Run `pnpm verify:fast` (must pass), then `pnpm verify:full`
      locally if a database is available.
- [ ] 11.6 Commit: `Bump to v0.4.0 and refresh CLI docs`.

## Phase 12 — Wrap-up

- [ ] 12.1 Update `docs/tasks/active/20260502-docs-cli-todo.md` status to
      `completed` and add a "Review" section summarizing what shipped and
      open follow-ups (e.g., real image upload during DOCX import,
      block-level write API, server-side rendering option).
- [ ] 12.2 Capture lessons in
      `docs/tasks/active/20260502-docs-cli-lessons.md` (per project
      convention).
- [ ] 12.3 Run `pnpm tasks:archive && pnpm tasks:index`.
- [ ] 12.4 Open PR with the v0.4.0 changes; reference the design doc.

## Open Questions / Pending Verification

- [x] Yorkie key prefix for word-processor docs — confirmed as
      `doc-<documentId>`? (Phase 3.1) — yes (frontend
      `app/docs/docs-detail.tsx:210`).
- [ ] Whether `PdfExporter` already accepts a page subset, or whether we
      must post-process via `pdf-lib`. (Phase 7.1)
- [ ] Whether the existing CLI test harness can mock `process.stdin` /
      `process.stdout` cleanly for `--out -` and `<file> -` paths. (Phases
      6, 7, 8)
