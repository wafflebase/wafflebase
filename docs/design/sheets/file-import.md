---
title: file-import
target-version: 0.5.0
---

# File Import — CSV / Parquet / JSON / Excel

> Part of the External Data Sources initiative — see the [epic index](../../tasks/active/20260625-sheets-external-data-sources-todo.md). The new
> formats here build on the embedded DuckDB engine from
> [lakehouse-connected-sheet.md](lakehouse-connected-sheet.md); the existing
> client-side path does **not** need DuckDB.

## Summary

Let users bring a **data file** — CSV, Parquet, newline-JSON, or Excel
(`.xlsx`) — into a Wafflebase document, either as an editable sheet (**Import**)
or a read-only tab (**Connect**).

Crucially, **Excel import already exists** and the design must not reinvent it.
This doc's job is to (1) record what already ships, (2) add the missing formats
(Parquet, JSON, and remote/large CSV), and (3) define the **two-engine split**
between the existing client-side parser path and the new backend DuckDB path.

## Current state (what already ships)

| Capability | Status | Where |
|------------|--------|-------|
| **`.xlsx` import** | ✅ **Shipped** (PR #270) — **multi-sheet**, client-side, materializes to editable `sheet` tabs | `packages/sheets/src/import/xlsx-importer.ts` (`importXlsxWorkbook` / `importXlsxFile`), `packages/frontend/src/app/spreadsheet/xlsx-actions.ts` (`pickAndImportXlsx`) |
| CSV import | ⚠️ **Not wired** — `papaparse` is already a dependency of `@wafflebase/sheets` but unused | `packages/sheets/package.json` |
| Parquet / JSON import | ❌ none | — |
| Remote / object-storage file Connect | ❌ none | — |

The shipped XLSX path is fully **client-side**: it unzips the workbook in the
browser, parses `xl/workbook.xml` + `sharedStrings.xml` + each worksheet, and
builds a `SpreadsheetDocument` of editable sheets — no server round-trip, no
native engine. This is the right model for "open this spreadsheet file", and it
should stay as-is.

## Goals / Non-Goals

### Goals

- **CSV import (quick win)** — wire up the already-present `papaparse` for
  small local CSV → editable sheet, mirroring the XLSX path. No DuckDB.
- **Parquet & JSON import** — small local files parse client-side (`hyparquet`
  for Parquet, `JSON.parse` for JSON); large/remote files parse via the
  **backend embedded DuckDB** engine and materialize. The split is by
  size/location, not format (see §1).
- **Remote / object-storage Connect** — point at `https://…` or `s3://…`
  (CSV/Parquet/JSON, glob/partitioned) and render a read-only tab via DuckDB +
  `ReadOnlyStore`.
- **Large-file path** — when a file exceeds the client materialize cap, route
  it through the backend (DuckDB) and offer Connect instead of choking the
  browser/Yorkie doc.
- Reuse the existing S3 upload infra for backend-parsed uploads.

### Non-Goals

- **Re-implementing XLSX import** — it already exists and is multi-sheet; only
  incremental polish (e.g., styles/formulas fidelity) is in scope, tracked
  separately.
- Writing edited cells back to the source file (export is a separate roadmap
  item).
- Schema mapping UI / transforms beyond header + type inference (later).

## Proposal Details

### 1. Two engines, by purpose

The key design decision: **don't force everything through one path.**

| Engine | Best for | Mode | Round-trip |
|--------|----------|------|-----------|
| **Client-side parsers** (existing XLSX; CSV via `papaparse`; small Parquet via `hyparquet`; small JSON via `JSON.parse`) | small local uploads | Import (materialize, editable) | none — runs in browser |
| **Backend DuckDB** (new) | large CSV/Parquet/JSON, remote/object files | Import (large) **and** Connect (read-only) | upload or read-in-place |

XLSX stays client-side (it works and avoids a server hop). CSV, and small
Parquet/JSON, get the same client-side treatment. DuckDB is added only where the
browser can't reasonably go: large files and remote/object sources.

### 2. CSV import (client-side, quick win)

- Add a CSV branch beside `pickAndImportXlsx` in
  `packages/frontend/src/app/spreadsheet/xlsx-actions.ts` (or a sibling
  `csv-actions.ts`) using the already-installed `papaparse`.
- Parse → build a one-sheet `SpreadsheetDocument` → editable sheet. The existing
  `createSpreadsheetDocumentFromImportedXlsxSheets` is typed for
  `ImportedXlsxSheet[]` (multi-sheet, XLSX-specific metadata like `cellCount`),
  so CSV either gets a small generic helper extracted from it
  (`createSpreadsheetDocumentFromImportedSheets`, taking a flat sheet shape) or a
  CSV-specific builder — don't force CSV through the XLSX-shaped abstraction.
- Header detection + basic type coercion (numbers/dates) on import.

### 3. Large / remote Parquet / JSON / CSV import (backend DuckDB)

- **Upload endpoint** stores the file in S3. Reuse only the underlying
  `S3Client` configuration from `image.service.ts` (endpoint, credentials,
  bucket, MinIO `forcePathStyle`, bucket auto-create) — not its image-specific
  processing. Extract a generic `StorageService` / `S3Service` rather than
  depending on the image domain. Store under a short-lived `imports/` key.
- **Parse via DuckDB**: `read_parquet(...)`, `read_json_auto(...)`,
  `read_csv_auto(...)` for large CSV.
- **Preview** returns first N rows + inferred columns (the datasource
  `{ columns, rows, truncated, … }` shape) so the user confirms before
  materializing.
- **Materialize** through the standard `Store` write path (the same one used
  for paste/fill) into an editable `sheet` tab, capped by a materialize limit;
  above the cap, suggest Connect.

### 4. Connect mode (remote / object-storage files)

Identical to a lakehouse tab but pointed at a raw file (or glob) rather than an
OTF table:

- Tab metadata stores the file URI + format.
- Read into `ReadOnlyStore`; **no** time-travel slider (raw files have no commit
  history — that is the OTF differentiator).

### 5. Frontend

- Extend the existing import entry point: file picker / drag-and-drop / URL
  field → detect format from extension/content → route:
  - `.xlsx` → existing client-side importer (unchanged).
  - `.csv` (small) → client-side `papaparse`.
  - `.parquet` (small) → client-side `hyparquet`; `.json` (small) → `JSON.parse`.
  - large / remote / object → backend DuckDB (preview → Import or Connect).
- Reuse `tab-bar.tsx` for the resulting tab and the datasource/lakehouse view
  shell for the Connect preview.

### 6. Format support matrix (target)

| Format | Import | Connect | Engine |
|--------|--------|---------|--------|
| Excel `.xlsx` (multi-sheet) | ✅ **already shipped** | — | client-side (sheets pkg) |
| CSV / TSV (small) | ➕ quick win | — | client-side `papaparse` |
| CSV / TSV (large / remote / object) | ➕ new | ➕ new | backend DuckDB |
| Parquet (small local) | ➕ new | — | client-side `hyparquet` |
| Parquet (large / partitioned glob / remote) | ➕ new | ➕ new | backend DuckDB |
| JSON (small local, ndjson / array) | ➕ new | — | client-side `JSON.parse` |
| JSON (large / remote) | ➕ new | ➕ new | backend DuckDB |

(✅ shipped · ➕ proposed)

## Current Limitations

1. XLSX style/formatting fidelity is out of scope here — tracked in
   [xlsx-style-import.md](xlsx-style-import.md). Formula fidelity (array
   formulas, cross-workbook refs) remains deferred and is not tracked there.
2. Import is capped by the Yorkie materialize limit; large files must use
   Connect.
3. DuckDB type inference may need manual reformat for ambiguous columns.
4. No transform/cleaning step (split, trim, pivot) at import time — edit after.

## Rollout

- **Phase 1** — CSV import (client-side `papaparse`) — smallest change, mirrors
  the shipped XLSX path.
- **Phase 2** — Parquet/JSON import via backend DuckDB (upload → preview →
  materialize), reusing S3 upload infra.
- **Phase 3** — Remote/object-storage **Connect** for raw files
  (glob/Hive partitioning) + large-file routing (Connect suggestion at the cap).

## Risks and Mitigation

| Risk | Mitigation |
|------|------------|
| Duplicating the existing XLSX importer | Explicitly out of scope; new work targets only CSV + DuckDB-backed formats. |
| Untrusted uploaded files | A restricted DuckDB connection: disable extensions that can fetch/exfiltrate (`httpfs`, `sqlite_scanner`, `fts`), cap `memory_limit` + `threads=1`, and expose only an allowlist of import functions (`read_parquet`/`read_csv_auto`/`read_json_auto`) — **no raw SQL passthrough** on the import path. Magic-number check before ingestion (e.g. Parquet `PAR1`). Isolate the `imports/` S3 prefix with TTL cleanup; run DuckDB in a sandboxed process/container where feasible. |
| Huge files bloating the Yorkie document | Materialize cap; suggest Connect mode above the cap. |
| Two engines diverging in behavior | Both produce the same `SpreadsheetDocument` / `{ columns, rows, … }` shape; share header/type-coercion helpers where possible. |
| S3 temp storage growth | Short-lived `imports/` keys, deleted post-import or by lifecycle/TTL. |

## References

- Existing XLSX importer: `packages/sheets/src/import/xlsx-importer.ts` (PR #270)
- [External Data Sources epic index](../../tasks/active/20260625-sheets-external-data-sources-todo.md) — umbrella + future roadmap
- [lakehouse-connected-sheet.md](lakehouse-connected-sheet.md) — DuckDB engine
- [datasource.md](datasource.md) — read-only spine + response shape
- DuckDB CSV import: <https://duckdb.org/docs/data/csv/overview>
- DuckDB Parquet: <https://duckdb.org/docs/data/parquet/overview>
- DuckDB JSON: <https://duckdb.org/docs/data/json/overview>
