# TODO — File Import in sheets (Roadmap ①)

Design doc: [file-import.md](../../design/sheets/file-import.md) ·
Issue bodies: [20260625-sheets-external-data-sources-issues.md](20260625-sheets-external-data-sources-issues.md) ·
Epic index: [20260625-sheets-external-data-sources-todo.md](20260625-sheets-external-data-sources-todo.md)

Engine split by **size/location, not format**: small local files parse
client-side; large/remote/object-storage files use the backend DuckDB engine
(LH-0). XLSX import already ships (`packages/sheets/src/import/xlsx-importer.ts`,
PR #270) — not a subtask.

Each subissue is one PR. Every task lists **what / files / reuse / done**.

## Subissue dependency graph

```
  FI-1 · CSV (client-side)      ── independent, ship first
  FI-2 · Parquet ┐
  FI-3 · JSON    ┘── (large path) ┄► depends on Lakehouse LH-0 (DuckDB engine)
  FI-4 · Remote/object Connect ──► depends on LH-0 + LH-6 (storage backends)
  FI-5 · Large-file routing ──► depends on FI-4
```

---

## FI-1 — CSV import (client-side)  ·  depends on: —

**Goal:** import a local CSV into an editable sheet, fully client-side. No backend.
**Primary files:** `packages/frontend/src/app/spreadsheet/csv-actions.ts` (new),
the import entry point that calls `pickAndImportXlsx`, `packages/sheets` for the
header/coercion helper.

- [ ] **Generalize the document builder (prerequisite refactor).**
  Scope: `createSpreadsheetDocumentFromImportedXlsxSheets` in `xlsx-actions.ts`
  is typed for `ImportedXlsxSheet[]` (XLSX-specific, e.g. `cellCount`). Extract a
  generic `createSpreadsheetDocumentFromImportedSheets` taking a flat sheet shape
  (or add a CSV-specific builder) so CSV isn't forced through the XLSX-shaped
  helper. Done: XLSX path still works; a generic builder exists for CSV.
- [ ] **`csv-actions.ts` (parse + map).**
  Scope: pick a `.csv`, parse with `papaparse` (already a `@wafflebase/sheets`
  dep), build a one-sheet `SpreadsheetDocument`.
  Reuse: the generic builder above.
  Done: a CSV file produces an editable sheet document.
- [ ] **Header detect + basic type coercion.**
  Scope: first row → bold header; coerce obvious number/date columns.
  Done: numbers/dates land as typed cells, not strings.
- [ ] **Wire into the import entry point.**
  Scope: add "Import CSV" beside the existing XLSX import action.
  Done: end-to-end picker → editable sheet.

**Acceptance:** CSV picker → editable single sheet (bold header); `pnpm verify:fast`.

---

## FI-2 — Parquet import  ·  depends on: Lakehouse LH-0 (large path)

**Goal:** import Parquet — small files client-side, large/remote via backend DuckDB.
**Primary files:** `packages/sheets` (hyparquet integration),
`packages/backend/src/file-import/` (new) reusing `lakehouse/duckdb.service.ts`,
`packages/backend/src/image/image.service.ts` (S3 upload), frontend import dialog.

- [ ] **Small local: client-side `hyparquet`.**
  Scope: add `hyparquet` dep; read a local `.parquet` in the browser → materialize
  via the standard `Store` write path.
  Done: a small Parquet imports with no server round-trip.
- [ ] **Large/remote: backend DuckDB `read_parquet` + preview.**
  Scope: upload to S3 (`imports/` prefix) via the image S3 infra; read with
  `DuckDbService.read_parquet`; return first-N preview in the shared
  `{ columns, rows, truncated }` shape; materialize on confirm.
  Reuse: `image.service.ts`, `DuckDbService` (LH-0).
  Done: a large Parquet previews then materializes.
- [ ] **Glob for partitioned sets (large path).**
  Scope: accept `.../*.parquet` + Hive partitioning.
  Done: a partitioned dataset reads as one table.

**Acceptance:** small Parquet client-side, large via backend; `pnpm verify:fast`
+ MinIO integration.

---

## FI-3 — JSON import  ·  depends on: Lakehouse LH-0 (large path)

**Goal:** import JSON — array-of-records → grid; nested → JSON-string cell.
**Primary files:** `packages/sheets` (mapping + `toCell` reuse),
`packages/backend/src/file-import/` (DuckDB large path).

- [ ] **Array-of-records → grid (client `JSON.parse`).**
  Scope: keys → columns, objects → rows for small files.
  Done: flat JSON imports as a clean table.
- [ ] **Nested values → JSON-string cells.**
  Scope: objects/arrays in a cell rendered via `toCell` (`JSON.stringify`).
  Reuse: `packages/sheets/src/store/readonly.ts` `toCell`.
  Done: nested fields show as JSON strings (matches the design's worked example).
- [ ] **Large/remote: backend DuckDB `read_json_auto`.**
  Scope: same upload→preview→materialize path as FI-2.
  Done: a large JSON file imports via backend.
- [ ] **Document tabular-vs-nested scope.**
  Scope: note that Power-Query-style nested **expand** is deferred.
  Done: scope captured in the design doc.

**Acceptance:** flat JSON tabular; nested → JSON-string cell; scope documented;
`pnpm verify:fast`.

---

## FI-4 — Remote/object-storage file Connect  ·  depends on: LH-0, LH-6

**Goal:** point at a remote/object raw file → read-only tab (no time-travel slider).
**Primary files:** `packages/backend/src/file-import/` (read via DuckDbService),
`packages/sheets/.../worksheet-document.ts` (file-connect `TabMeta`),
`packages/frontend/src/app/spreadsheet/` (URL field + view).

- [ ] **Backend read remote/object file → response shape.**
  Scope: read `https://…` / `s3://…` (glob/Hive) through `DuckDbService`;
  `LIMIT` + truncation; return `{ columns, rows, … }`.
  Reuse: LH-6 storage secrets, `DuckDbService`.
  Done: a remote Parquet glob returns rows.
- [ ] **File-connect tab.**
  Scope: a read-only tab storing `{ uri, format }` in `TabMeta`; render via
  `ReadOnlyStore`; no slider (raw files have no commit history).
  Done: tab persists + renders.
- [ ] **Frontend URL field.**
  Scope: add a URL input to the import entry → Connect.
  Done: paste a URL → read-only tab.

**Acceptance:** remote Parquet glob renders read-only; `pnpm verify:fast`.

---

## FI-5 — Large-file routing  ·  depends on: FI-4

**Goal:** protect the browser/Yorkie doc from oversized materialization.
**Primary files:** `packages/frontend/src/app/spreadsheet/` (import flow).

- [ ] **Materialize cap + Connect suggestion.**
  Scope: when an upload exceeds a configurable rows×cols cap, stop materializing
  and offer Connect mode instead.
  Done: a large file routes to Connect with a clear prompt; cap documented.

**Acceptance:** large CSV/Parquet routes to Connect; `pnpm verify:fast`.

---

## Cross-cutting

- [ ] `docs/design/README.md` Sheets section updated (done on ideation branch)
- [ ] Lessons in paired `20260625-sheets-file-import-lessons.md`
- [ ] After all merged: `pnpm tasks:archive && pnpm tasks:index`

## Review

(filled in at completion)
