# TODO — Small client-side JSON import

Issue: [#555](https://github.com/wafflebase/wafflebase/issues/555) ·
Design: [file-import.md](../../design/sheets/file-import.md)

## Goal

Import local JSON, JSONL, and NDJSON files in the browser, convert records into
an editable `SpreadsheetDocument`, and persist it through the existing Yorkie
upload flow. Backend DuckDB routing is deferred.

## Plan

- [x] Add a shared imported-sheet shape and generic spreadsheet document builder.
- [x] Add a JSON/NDJSON parser and record-to-worksheet mapper.
- [x] Reuse normal sheet input inference for imported primitive values.
- [x] Route JSON extensions through the generic upload classifier and sheet
  dispatcher so both the `Upload files…` picker and drag-and-drop work.
- [x] Cover parser, mapping, dispatcher, and upload queue behavior with tests.
- [x] Run the `verify:fast` package checks with local package binaries.
- [x] Review the complete branch diff and record lessons.

## Input contract

- Whole JSON accepts one object or a non-empty array of objects.
- If auto-mode whole-document parsing fails, retry as NDJSON.
- NDJSON parses each non-empty line as one object and reports line numbers.
- Columns are the union of record keys in first-seen order.
- Missing and `null` values stay empty; nested values become JSON strings.
- Primitive cell text uses the same type and formula inference as normal input.
- Empty input, no-column records, arrays of arrays, and primitive records fail.

## Out of scope

- Client/backend size threshold.
- Backend DuckDB `read_json_auto`.
- Recursive expansion of nested objects.
- Array-of-arrays import.

## Review

- Parsing finishes before `createDoc`, so malformed input cannot leave backend
  metadata or an empty Yorkie document.
- Existing XLSX imports retain their compatibility exports while the upload
  queue now uses the format-neutral dispatcher.
- The full `pnpm verify:fast` command could not select the pinned pnpm release
  because registry signature verification was unavailable in the environment.
  Every command in the gate was run directly with the installed package
  binaries instead; sandbox-dependent backend and CLI checks passed when
  rerun with local-port and network access.
