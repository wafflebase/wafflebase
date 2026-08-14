# JSON import manual fixtures

Use these files from the document list's **New → Import JSON** action or by
dragging them onto the list.

- `people.json`: array JSON covering first-seen columns, missing/null cells,
  booleans, dates, percent, currency, leading-zero text, formulas, nested
  objects, and arrays. It should create a `people` document and tab.
- `events.ndjson`: valid line-delimited JSON with a blank line and heterogeneous
  keys. The blank line should be ignored.
- `events-lines.json`: NDJSON content with a `.json` extension. It should import
  through automatic NDJSON fallback.
- `broken.ndjson`: malformed record on source line 3. It should show
  `Invalid NDJSON at line 3` and must not create backend document metadata.

After a successful import, hard-refresh and reopen the sheet to verify that the
content was persisted to Yorkie rather than retained only in browser memory.
