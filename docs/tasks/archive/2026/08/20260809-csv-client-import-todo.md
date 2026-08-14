# TODO — Client-side CSV / TSV import

Issue: [#553](https://github.com/wafflebase/wafflebase/issues/553) ·
Design: [file-import.md](../../design/sheets/file-import.md)

## Goal

Import local `.csv` and `.tsv` files in the browser as editable sheets, at any
file size that fits a Yorkie document. No backend upload, no DuckDB path.

## Plan

- [x] Add a streaming `TableWriter` in `@wafflebase/sheets`, bounded by a cell
  budget and a document-byte budget.
- [x] Derive both budgets from measured Yorkie `getDocSize()` costs rather than
  estimates.
- [x] Drive PapaParse in local-file mode from the frontend, with encoding
  detection, delimiter sniffing, and a malformed-file guard.
- [x] Return the format-neutral `ImportedSheet` so CSV joins the shared
  `importSheetFile` dispatcher added by JSON import.
- [x] Surface truncation as an upload-queue warning.
- [x] Cover writer, parser, dispatcher, and queue behavior with tests.
- [x] Grow both worksheet axes once per bulk load.
- [x] Review the branch diff and record lessons.

## Input contract

- `.tsv` uses tab; `.csv` sniffs its delimiter from the header line, outside
  quotes, across `, ; \t |`.
- Encoding is UTF-8 or CP949, decided by sampling three fixed 64 KB windows.
- Values use the same inference as normal input, except a leading `=`, which is
  stored as literal text.
- Import stops on a row boundary at 40,000 cells or 8 MB, reporting the row
  extent that arrived.
- Empty input, a header-only budget overflow, and an unterminated quoted field
  all fail before any document is created.

## Out of scope

- Backend staging and DuckDB parsing for large files.
- Full-file encoding detection.
- Parquet import (#554).

## Review

- The client-only decision is measured, not assumed: parsing plus worksheet
  conversion costs ~55–95 ms at a full budget, and ~168–196 ms at 90,000 cells
  (99% of the Yorkie cap). Uploading the file costs more than parsing it
  locally at any size that fits.
- Those figures are the import pipeline, not wall clock. A 40,000-cell file in
  local `pnpm dev` takes about 4–5 s once Yorkie persistence, the
  document-create round trip, and the first render are included — none of which
  a server-side parser would remove.
- Parsing finishes before `createDoc`, so a malformed file cannot leave backend
  metadata or an empty Yorkie document behind.
- `pnpm verify:fast` fails on this machine at
  `tests/app/slides/toolbar/text-edit-section.test.ts`, a pre-existing timeout
  flake unrelated to this branch. Its lanes were run individually instead;
  the frontend suite passes in full with `--testTimeout=20000`.
