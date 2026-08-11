# Lessons — Client-side CSV / TSV import

## What changed from the original design

The first design read the file with `file.text()` and handed PapaParse one
string. The string and the parse result then sat in the browser heap together
at roughly seven times the file size, and V8 caps a string at `2^29-24`
characters — so the design split at 25 MB and routed larger files to a backend
staging bucket plus an embedded DuckDB parser.

PapaParse accepts a `File` directly and reads it in chunks. Handing the file
over whole removes the string entirely, which removes the cap, which removes
the reason the backend path existed. Measuring what remained confirmed it: a
full-budget import is ~55–95 ms, and ~168–196 ms even at 99% of the Yorkie
document limit. Uploading a file costs more than parsing it locally at every
size that fits in a document, so the whole backend half of the feature was
dropped rather than kept as an unused branch.

## Notes

- The bound that matters is the Yorkie document, not the file. Cost follows
  cells imported, not bytes on disk, so a 5 GB file and a 5 MB one both stop at
  the same budget and neither is read to the end.
- A cell count cannot stand in for document bytes. A value of 8 characters
  costs ~122 bytes and one of 200 costs ~503, since Yorkie sizes strings as
  UTF-16 — and a styled cell (a date or a price) costs roughly twice what its
  text alone predicts. Both were found by measuring `getDocSize()`, not by
  reasoning about the model.
- PapaParse's own delimiter guess scores field-count consistency, so the
  trailing newline nearly every CSV has makes the real delimiter look
  inconsistent. A semicolon file — the Excel default across much of Europe —
  imports as a single column. Counting the header line directly is narrower and
  deterministic.
- Encoding has to be sampled in more than one place. A head-only probe calls a
  file UTF-8 the moment its first 64 KB is ASCII, and CP949 bytes after that
  point decode without error into the wrong characters.
- When skipping continuation bytes to align a mid-file sample, the limit is 3,
  not 4. Four consecutive continuation bytes cannot occur in valid UTF-8, and
  CP949 Hangul produces them in pairs — `가가` is `B0 A1 B0 A1`.
- An unterminated quote is the one input that grows without bound: no row
  boundary means no row, so no budget ever fills. It needs its own byte
  threshold, measured in bytes rather than chunk counts, because chunk size is
  configurable.
- Bulk loaders should grow both worksheet axes once. Extending the row axis per
  row pays the axis scan per row; hoisting it took a 50,000-cell fill from
  ~1.1 s to 64 ms.
- Import writes the document directly and never runs the calculator, so a
  formula cell would carry no cached value and render blank. A leading `=` is
  stored as literal text for that reason. The JSON importer routes values
  through `cellFromInput` and does not make this distinction — worth
  reconciling.
