# Import CSV / TSV files as editable sheets (issue #553)

PR: (to be filled after opening)

Design: [file-import.md](../../design/sheets/file-import.md) ·
Epic: [20260625-sheets-file-import-todo.md](20260625-sheets-file-import-todo.md)
(FI-1, plus FI-5's materialize cap)

**Status:** `verify:fast`, `verify:self`, and `verify:integration` (including
the Yorkie-attached e2e suites) all green as of 2026-08-04 — see Verification.
**Short on time?** Goal → Approach → decisions 2, 7, 11, 14 → Known
limitations covers the reviewable core.

## Goal

Import a local `.csv` / `.tsv` into an editable sheet. FI-1's acceptance is a
one-sheet document from papaparse, bold first row + number/date coercion, an
"Import CSV / TSV" entry point, and `pnpm verify:fast` green.

See Approach for the two-engine split (client vs. backend) and decision 2 /
limitations 3, 13 for the one place file size still shows through — whether
the header row renders bold.

## Approach

Two parsers, one engine: small files parse in the browser, files over 25 MB
upload and parse server-side through an embedded DuckDB. Both converge on the
same `importTable` in `@wafflebase/sheets`, so **file size never decides what a
cell's value becomes** — that invariant is what most of the design below
defends. It holds for every value and format: the same bytes coerce identically
on both paths.

The one thing size *does* change is whether the header row is bold, and only
for a file that has no header. The server sniffs that and the browser cannot —
see decision 2 and limitations 3 and 13.

`.tsv` states its delimiter on both paths instead of leaving it to be sniffed —
`csv-actions.ts` passes `'\t'` into `importCsv`, `duckdb.service.ts` passes it
into `read_csv`/`sniff_csv` — because one comma inside a tab-separated field is
enough to outscore the tabs and collapse a row. It ships here because the issue
title says "CSV / TSV".

### Engine — `packages/sheets/src/import/csv-importer.ts`

`importTable(rows, options?)` writes a row-major table into one `Worksheet`:
per cell `inferInput` →
`toStoredValue` + `applyInferredFormat` → `compactCell` → `writeWorksheetCell`,
one `rangeStyles` patch bolding the first row that produced a cell — unless the
caller passes `{ hasHeader: false }` — and a `MAX_IMPORT_CELLS` (50,000) budget
enforced on row boundaries. `importCsv(text, options?)` is papaparse in front of
it: it forwards `hasHeader` to `importTable` and takes its own `delimiter`
option so `.tsv` can state its separator instead of leaving papaparse to guess
it. Both return `{ worksheet, rowCount, truncated }`.

### Backend — `packages/backend/src/file-import/` + `src/lakehouse/`

`POST /workspaces/:wid/file-imports/upload` stages the blob (200 MB Multer cap,
`imports/` key prefix with a 1-day lifecycle rule), `…/preview` parses it and
returns `{ columns, rows, rowCount, truncated, hasHeader }`. `DuckDbService` is
the minimal LH-0 subset: one lazy in-memory instance, `memory_limit=512MB`,
`threads=1`, extension autoload/autoinstall off, and a format→SQL allowlist
instead of raw SQL. `read_csv(all_varchar, null_padding, parallel = false,
header = false)` — every option is load-bearing; `header = false` sits on its
own constant, since `sniff_csv` must never receive it (decision 14), while the
other three are shared between the reader and the sniff.

### Frontend

`upload-kind.ts` maps `csv`/`tsv` → `"sheet"` (the real drag-and-drop gate) and
owns `CLIENT_PARSE_MAX_BYTES`. The queue's sheet arm branches on extension,
then on `file.size`; `csv-actions.ts` has `importCsvFile` (client) and
`importSheetViaBackend` (server), the latter flattening the preview into rows
for the same `importTable`.

## Design decisions

Rationale that is not already a comment at the call site. Decisions 1, 2, 4,
5, 7, 9–12 and 14 affect behavior, the API, or security; 3, 6, 8 and 13 are
implementation/scope notes kept here for the same reason.

1. **A leading `=` is stored as literal text.** Import never runs the
   calculator and `toDisplayString` reads only `v`, so a formula cell with no
   cached value would render blank. XLSX carries Excel's cached value; CSV has
   none. Re-entering the cell commits a real formula.
2. **The first row with content is bold; the server may say otherwise.** The
   epic asks for "first row → bold header" and nothing about detecting one, and
   `loadQueryResults` sets the same unconditional `{ b: true }`. The drafted
   heuristic ("row 1 all text AND row 2 has non-text") fails on all-string
   CSVs — the common case — so it would miss the acceptance criterion to avoid
   a one-click-undo false positive. "First row with content" rather than row 1
   because a leading `,,` row is kept (decision 4).

   **Amended after review.** `importTable` takes `{ hasHeader }` and skips the
   bold when it is `false`; the backend path passes DuckDB's sniff verdict. This
   was rejected in the first draft on the grounds that it lets file size change
   the result, which it does — a headerless file is bold at 24 MB and plain at
   26 MB. Two things make that the better trade:

   - It is not the heuristic this decision rejects. DuckDB's sniffer is real
     information the server already has, and it is the only thing that can tell
     a header from a first record on that path — the same verdict decision 14
     leans on. Reading it and then ignoring it was the inconsistency.
   - The divergence is one style bit on one row, one click to undo, and it only
     appears on headerless files — where "plain" is the correct rendering and
     "bold" is a heading the user never wrote. Neither path was made worse.

   Closing the gap needs a client-side sniff, which is exactly the heuristic
   this decision rejects. Recorded as limitation 13 rather than built.
3. **`toStoredValue` moved to `input.ts` and is exported**; no combined
   `inferCell` helper, since decision 1 means CSV never reaches its formula
   branch. Precedent: `c20d418b7` made `toStoredValue` and `applyInferredFormat`
   private together, `c713e9ac5` moved the latter out when the calculator needed
   it. The CSV importer is `toStoredValue`'s first outside consumer.
4. **No `skipEmptyLines`.** Both skip modes delete a blank row a user put
   *inside* a table and shift every row below it up. The trailing-newline
   artifact the default leaves is free — the extra row writes no cells.
5. **Only papaparse's `MissingQuotes` is fatal**, not the whole `Quotes` type:
   its sibling `InvalidQuotes` is what a file of inch marks (`5" x 7"`) reports
   after parsing correctly. `UndetectableDelimiter` (always reported for a
   single-column file) and ragged rows are noise.
6. **No importer registry and no dispatch layer.** #554 / #555 are unassigned
   with no code, and `importTable` + the preview response are already
   format-agnostic — Parquet and JSON each add one `READER_SQL` entry. The
   dispatch shape is for their owners to settle.
7. **The cell budget lives in the engine, not the backend.** It is the one place
   both paths meet, so it is the only place it can be authoritative;
   `file-import.service.ts` reads `MAX_IMPORT_CELLS` to bound what crosses the
   wire. Deliberately not `datasource.service.ts`'s `MAX_ROWS = 10_000`, which
   governs a read-only path that materializes nothing — and which at 10 columns
   would exceed Yorkie's 10 MB document limit.
8. **`ensureAxisLength`'s early return ships here after all.** It was split out
   as an unrelated perf fix, but the cap raised the ceiling to 50,000 cells and
   the quadratic rebuild made that import take ~13 s. It is now on the critical
   path of this feature, not beside it. One line, no behavior change.
9. **A staged import blob gets its own id pattern.** `VALID_FILE_ID_PATTERN`
   grants document-servable access (share links included);
   `VALID_IMPORT_FILE_ID_PATTERN` deliberately does not overlap it, so a data
   blob can never be read back by attaching it to a document.
10. **The expiry rule is merged into the bucket's lifecycle, not written over
    it.** `PutBucketLifecycleConfiguration` replaces the *whole* configuration,
    so writing our rule alone deleted every operator-managed rule on the bucket
    on each boot, silently — the surrounding `catch` only warns. It now reads
    first and merges by rule ID. The load-bearing part is the read's `catch`: a
    bucket with no configuration is the first-boot case and the only failure
    safe to treat as empty, so anything else skips the write instead of falling
    through with an empty base, which would be the same wipe.
11. **Membership is a guard on this controller only.** `assertMember` in the
    handler is the repo-wide convention (folder, datasource, document) and it
    stays. This route is the one carrying a 200 MB Multer ceiling, and NestJS
    resolves guards before interceptors — an inline check runs only after the
    whole body is already in memory. Measured: a non-member posting 31 MB is
    refused after 1.7 MB. The `fileFilter` is the other half; a Multer limit is
    a size, not a type, so without it that ceiling applied to a `.png` too.

    A third piece, added after the fourth review: the *route* now names the
    category it stores (`FileService.upload(file, mimeType, fileName, {
    category, workspaceId })`). The filter reads the file name and the service
    used to read the declared type, so between them a caller could still pick
    which rules applied — `x.csv` sent as `image/png` cleared the name filter,
    was buffered against 200 MB, met the 25 MB image cap, and landed at the
    bucket root rather than under `imports/`. The same slack made `POST
    /files`, which has no workspace check, a second way into the import
    prefix. Only the route knows which of the two it is; nothing in the
    payload does. `workspaceId` on the same options object is what scopes the
    stored key to `imports/<workspaceId>/<id>` rather than a flat `imports/<id>`
    — a leaked blob id from one workspace is unreadable from another.
12. **A missing staged blob is a 410, not a 400 or a 500.** Blobs expire after a
    day and `IMPORT_EXPIRY_DAYS`' own comment promises "a retry the user comes
    back to", so the client has to tell "this id is spent" from "this file will
    not parse" — a status, not message text. On a 410 the queue clears
    `item.fileId`, which is what makes the existing Retry re-upload instead of
    re-previewing a dead id forever.
13. **The `fast-xml-parser` override floor was raised to 5.7.3.** The security
    override forced the SDK's exactly-pinned 5.5.8 up to 5.7.0, which rejects
    `#` in an entity name — and `@aws-sdk/xml-builder` registers
    `addEntity('#xD', '\r')` on its shared parser. Every S3 call that parses an
    XML body therefore threw, including error bodies, so decisions 10 and 12
    were both inert: the lifecycle read always failed and `NoSuchKey` could
    never be read off an error response. 5.7.2 fixed the validation. Not
    incidental to this branch, but not caused by it either — see Follow-up.
14. **The reader is told there is no header; the sniffer must not be.** With a
    header DuckDB *consumes* row 0 and exposes it only as column names — which
    it has post-processed, so `a,a,b` arrives as `a, a_1, b`, `name,,qty` as
    `name, column1, qty`, and a file starting with a blank line reports the
    header *and* hands it back as the first data row. All three reached the
    sheet as header text the file never had. `header = false` makes row 0 the
    file's own line, and `hasHeader` shrinks to deciding the bold.

    The same option must never reach `sniff_csv`, which is why there are two
    constants rather than one. To the sniffer it is not a request to leave the
    header alone — it is the answer:

    | file | `sniff(shape)` | `sniff(shape, header = false)` |
    |---|---|---|
    | `name,qty\napple,3` | `true` | **`false`** |
    | `a,b\n1,2,3` | `true` | **`false`** |

    So the earlier "both calls get the *same* options" rule narrows to "both
    get the same **shape** options". The `null_padding` half still holds and
    still matters — an unpadded sniff of a padded read disagrees about
    `a,b\n1,2,3`. A test pins the sniffer's verdict so merging the constants
    back is not a silent regression.

    Two consequences. The budget stops reserving a row (that reservation
    existed only because the client used to prepend one), and a file that is a
    header with no data rows now imports instead of 400ing — papaparse always
    imported it, so the paths now agree where they used to split on size.

## Work

The branch was built and reviewed as eighteen finer-grained commits (client
path, backend path, then four review passes), then squashed into eight
layered commits before opening the PR — `git log` on this branch now shows
the finished shape, not the review chronology. The review-round fixes
(decisions 2's amendment and 10–14, the `dismissItem` comment, decision 11's
third piece) are folded into the commit for the layer they touch rather than
kept separate; see Review below for what each round found.

- [x] `Move papaparse from devDependencies to dependencies in sheets` — it is
      inlined into the build output (`vite.build.ts` externalizes only `assert`
      and `util`), so it is a runtime dependency by definition; `742d12e18` put
      `jszip` there for the same reason. Do **not** claim knip enforces this —
      `verify-entropy.mjs` reads only knip's `files`/`exports`/`types`.
- [x] `Raise the fast-xml-parser floor to a version the S3 client can use` —
      decision 13. A repo-wide S3/XML bug this branch happened to hit first;
      kept as its own commit so it stays cherry-pickable independent of CSV.
- [x] `Speed up bulk worksheet writes with an early axis-length return` —
      `worksheet-grid.ts`, decision 8. No behavior change; it is on the
      critical path only because the cap below raises bulk writes to 50,000
      cells.
- [x] `Parse CSV and TSV into a worksheet in the sheets package` —
      `csv-importer.ts` (`importCsv` + `importTable` + `MAX_IMPORT_CELLS`),
      `toStoredValue` moved to `input.ts` and exported, `index.ts` export,
      tests.
- [x] `Store data files for backend-parsed sheet imports` — `FileService`'s
      `'data'` upload category, `VALID_IMPORT_FILE_ID_PATTERN`,
      `MAX_DATA_UPLOAD_BYTES`, the workspace-scoped `imports/<workspaceId>/<id>`
      key (decision 11's third piece), the merged lifecycle rule (decision 10),
      and the binary-content reject on the upload path.
- [x] `Parse staged data files with an embedded DuckDB reader` — `lakehouse/`
      (`DuckDbService`, the bounded-concurrency read gate) and `file-import/`
      (service, controller, DTO, module), reusing the shared
      `WorkspaceScopeGuard` (decision 11) rather than a dedicated guard.
- [x] `Import CSV / TSV files as editable sheets` — `csv-actions.ts`,
      `upload-kind.ts` (`CLIENT_PARSE_MAX_BYTES`), `upload-queue.ts`'s size
      branch, `document-list.tsx`, and a `Blob.prototype.text()` polyfill in
      `tests/setup.ts` (jsdom implements neither `text()` nor `arrayBuffer()`;
      CSV is the first importer to read text rather than bytes).
- [x] `Add the CSV import task plan` — this document.

## Verification

```bash
pnpm verify:fast                                    # commit gate
pnpm frontend build && pnpm verify:frontend:chunks  # not part of verify:fast

# Frontend types have no gate at all — run this by hand
pnpm sheets build                                   # or tsc reads a stale dist
npx tsc --noEmit -p packages/frontend/tsconfig.app.json
```

- **Frontend type errors are caught by nothing**: no `typecheck` script,
  `frontend lint` is not type-aware, `vite build` is transpile-only. Judge by
  count against a fresh `upstream/main` worktree — the baseline moves with every
  rebase — and grep the output for the files this branch touches.
- **`pnpm verify:fast` can go red on this machine for two reasons of its own**,
  neither caused by this branch:
  - **Frontend tests flake at vitest's 5,000 ms default under CPU contention** —
    observed on `slides/toolbar/text-edit-section.test.ts` (3.4 s standalone),
    `components/text-formatting/font-family-picker.test.ts` and
    `slides/border-picker-close.test.ts`. All three pass at
    `--testTimeout=20000`, and a run with nothing else competing for the machine
    is green as-is — the same tree failed three of them under a concurrent load
    and then passed all 1,030 on its own, with the *slower* run being the one
    that passed. Judge with
    `pnpm --filter @wafflebase/frontend exec vitest --run --testTimeout=20000`.
  - `board typecheck` fails on `@wafflebase/slides` exports that exist in source
    but not in a stale `packages/slides/dist`. `verify:fast` never builds slides,
    so run `pnpm slides build` first — CI does not hit this because
    `verify:self` builds everything ahead of the test lanes, which a full green
    `verify:self` run on this tree confirms.
- **The DuckDB native binary is new to CI.** All three jobs are `ubuntu-latest`,
  not containers, so `@duckdb/node-api` resolves a prebuilt binary — confirm on
  the first push.
- **All three lanes ran green on the final 8-commit tree** (2026-08-04, local
  Docker stack: Postgres + Yorkie + MinIO):
  - `verify:self` — **11/11 lanes** in 323.6 s, including `verify:fast`.
  - `verify:integration` and `verify:integration:docker` — 7 suites, 49 tests.
    Five suites skip: the `:docker` script starts Postgres only, and neither
    script sets `RUN_YORKIE_INTEGRATION_TESTS`, which CI does set.
  - Those five were covered separately with
    `RUN_DB_INTEGRATION_TESTS=true RUN_YORKIE_INTEGRATION_TESTS=true` against a
    running Yorkie — **12/12 suites, 56/56 tests**, matching CI's coverage.

Manual smoke against `test-files/` (all passing):

| Fixture | Expected |
| --- | --- |
| `01-basic.csv` / `02-basic.tsv` | menu + drag-and-drop both import; columns split, header bold, numbers/dates right-aligned and formatted |
| `03-ragged.csv` | short rows keep their columns, no shift |
| `04-headerless.csv` | imports; row 1 bold — papaparse cannot tell (limitation 3) |
| `05-empty.csv` | fails the item with "This file does not contain any data." |
| `06-broken-quote.csv` | fails with "This file has an unterminated quoted field." instead of one giant cell |
| `07-over-cap-client.csv` | client path, truncated at 50,000 cells with the row-count warning |
| `10-large.csv` (28 MB) | routes to the backend; "Uploading…" → "Parsing on server…" → truncated warning |
| `11-large-ragged.csv` | same, columns intact (`null_padding`) |
| `12-large-headerless.csv` | same, but row 1 **plain** — DuckDB reports `hasHeader: false` (decision 2) |
| `13-large-quoted-newline.csv` | a field holding a newline survives as one cell — the case that threw before `parallel = false` |

Also verified earlier in the branch: a BOM-prefixed CSV has a clean first header
cell (`=LEN(A1)` → 4, not 5, with Korean text decoding correctly), `=1+1` shows
as text, and a `.zip` is skipped with "Unsupported file type".

### Against a live stack (done — results recorded here)

The review fixes touch storage and request-pipeline behavior that unit tests
mock, so they were re-checked against real Postgres / MinIO / Yorkie with the
backend built from this branch. Everything below is measured, not inferred.

Storage, by restarting the backend between steps:

- A foreign lifecycle rule (`operator-tmp`) survives a boot untouched, and a
  stale `expire-staged-imports` is **replaced, not duplicated** — the merge is
  by rule ID.
- With the configuration deleted the rule is still created, so MinIO does raise
  `NoSuchLifecycleConfiguration` and decision 10's narrow `catch` matches it.
- Deleting a staged object and re-previewing its id returns **410** with
  "This upload has expired. Import the file again."; re-uploading recovers.
  On the pre-fix build this was a 500 carrying a raw SDK message.

Request pipeline:

- `.png` → **400** `Cannot import fake.png.` at the Multer filter, nothing
  stored. Worth noting the pre-fix behavior was a *success*: `image/png` is in
  `allowedMimeTypes`, so it stored a `<uuid>.png` no preview could ever read.
- A non-member posting `header-30mb.csv` → **403 after 1.7 MB of 31 MB
  uploaded**, in 7 ms. That number is the evidence for decision 11: the body is
  never buffered.

Reader, re-measured after decision 14 (every one of these was wrong before it):

- A field holding a newline previews **200** and stays one cell
  (`"line one\nline two"`). It threw, and reached the user as a 500.
- A file starting with a blank line returns its header **once**, as row 0.
- `a,a,b` comes back as `["a","a","b"]`, not `a, a_1, b`; `name,,qty` as
  `["name", null, "qty"]`, not `name, column1, qty`. `null` writes no cell, the
  same as papaparse's `""`.

Upload category and the streamed read, re-probed after the fourth pass:

- `POST /files` with a `.csv` (and a `.tsv`) → **400**. It stored them under
  `imports/` before, past the workspace check the import route enforces.
- The import route with `x.csv` declared `image/png` → stored as
  **`imports/<workspaceId>/<uuid>.csv`**, not `<uuid>.png` at the bucket root.
  Nothing reached the root at all.
- A ~30 MB CSV read as a stream → identical to the buffered read: 6 columns,
  `hasHeader: true`, `rowCount` 8,333, row 0 the file's header.
- A deleted blob still previews as **410**, and no `wafflebase-import-` temp
  directory survives either path.

Row budget, on ~30 MB fixtures — the user-visible counts did **not** move,
which is the point: only where the header is counted changed.

- With a header: `hasHeader: true`, `rowCount` **8,333** = `floor(50000 / 6)`,
  header included, 49,998 cells. Previously the server sent 8,332 and the
  client prepended one to reach the same 8,333.
- Without: `hasHeader: false`, **12,500** = `floor(50000 / 4)`, hitting the
  50,000-cell cap exactly. Row 0 is the user's first record.

In the browser, both via the menu and via drag-and-drop: `.tsv` splits on tabs
with a quoted `12"` field intact; the large CSV shows "Uploading…" →
"Parsing on server…", bolds row 1 and warns at 8,333; the large headerless one
renders **every row plain** and warns at 12,500.

## Known limitations

### Path & size-dependent behavior

| # | Limitation | Why |
| --- | --- | --- |
| 1 | UTF-8 only, on **both** paths; CP949 / EUC-KR (Korean Excel's default) does not import | `File.text()` is fixed to UTF-8, and DuckDB's reader supports only `utf-8`/`utf-16`/`latin-1` without the 352 MB `encodings` extension this service deliberately cannot autoload. Derived and confirmed at the decoder level, never observed end to end — no CP949 file was tested, which is the miss. A BOM is stripped. Not "needs a library": see Follow-up, the client side is `TextDecoder('euc-kr')` and no dependency. |
| 3 | On the client path the first row is always bold, even in a headerless file | Decision 2; one click to undo. papaparse reports nothing about headers and detecting one is a heuristic the epic never asked for. The backend path does know, and skips the bold. |
| 13 | A headerless file crossing 25 MB changes appearance: bold row 1 below, plain above | Decision 2. Closing it needs a client-side header sniff — the heuristic decision 2 rejects — so it is recorded rather than built. |
| 14 | A row with **more** fields than the header, appearing past DuckDB's 20,480-row sample, rejects the whole file | Inside the sample `null_padding` widens the table instead. Past it the schema is fixed, and the read raises `Invalid Input Error: … Expected Number of Columns: 3 Found: 4` — a clean 400 naming the line. It only bites when the bad row is *also* inside the row budget: a 21,002-row file read at `LIMIT 8334` never reaches it. papaparse never errors on ragged rows, so this is a size-dependent difference; forcing agreement means either sampling the whole file or `ignore_errors`, which hides real corruption. |
| 16 | DuckDB drops a leading blank line where papaparse keeps it | The two paths differ by one empty row for a file that starts blank. The bold lands on the header either way, since `importTable` anchors on the first row that produced a cell. |

### Value coercion (`inferInput`)

| # | Limitation | Why |
| --- | --- | --- |
| 2 | A cell starting with `=` is text, not a formula | Decision 1 |
| 6 | `3/4` → `2026-03-04`; `1e5` → `100000`; `1,234` → `1234`; `00123` stays text | Intended `inferInput` normalization, identical to typing and pasting |
| 7 | Only `yyyy-mm-dd` is a date — `2026.08.01` and `2026/08/01` stay text | `parseIsoDate`'s regex. Dot-separated dates are the Korean Excel default, so this bites real files; the fix belongs to `inferInput`. See Follow-up. |
| 8 | Integers past `Number.MAX_SAFE_INTEGER` lose digits; a leading `+` is dropped | `toStoredValue` round-trips through a JS `number`. Same as pasting, but unrecoverable after import. See Follow-up. |

### Capacity, scope & product gaps

| # | Limitation | Why |
| --- | --- | --- |
| 4 | Imports stop at 50,000 cells and warn | Decision 7. One CRDT subtree per cell: 5,000 × 10 is 6.44 MB of a 10 MB document (87% metadata), and ~7,700 rows fails outright. |
| 5 | Over the cap the user gets a truncated sheet, not a Connect offer | FI-5's Connect half depends on FI-4, which does not exist yet |
| 9 | A large import outside a workspace (`/documents`) is refused | The preview route is workspace-scoped because a blob has no owner to check |
| 10 | Multer buffers the whole upload, so 200 MB × concurrent uploads is a real RSS ceiling | Raising the cap needs streaming upload first. The *read* side no longer doubles it — `preview` streams the staged blob to the temp file rather than resolving it and copying it — but the upload buffer is untouched. |
| 11 | The repo has two CSV parsers | `packages/cli/src/util/csv-parse.ts` hard-codes the comma and runs over REST; not a merge candidate |
| 12 | The tab is named `Sheet1`, not after the file | CSV has no sheet name; the document title already carries the filename. One line to change — see Open questions. |
| 15 | The cell cap does not bound bytes, so a wide-text file can still exceed the Yorkie document limit | `MAX_IMPORT_CELLS` counts cells because per-cell CRDT metadata dominates for ordinary values (~87% of the measured 1.29 MB per 1,000 rows × 10 columns). It stops being the dominant term for long text: 50,000 cells of 800 characters is ~38 MB of payload alone, under the cap and far past the 10 MB wall, so `applyImportedContent` still fails with the raw `document size exceeded` this exists to prevent. Closing it means a second budget in `importTable`, and the constant has to be measured (`Document.getDocSize` over long-text cells) rather than guessed. See Follow-up. |

## Review

### Round 1 — initial branch review

`/code-review` over the branch. Applied: throw on `MissingQuotes`; anchor the
header patch on the first row that produced a cell; drop the stale word "four"
from `ImportMenuItems`' JSDoc (this diff adds an entry to that very component).

Pushed back, recorded here instead:

- *Route by `EXT_TO_KIND` instead of re-deriving `/\.(csv|tsv)$/i`.* Widening
  `classifyUploadKind` is more API for a second sheet extension nobody has asked
  for, and a wrongly routed file is not a silent failure — it reaches
  `importXlsx`, JSZip throws, the item lands in `error`.
- *Guard long-integer precision inside the importer.* Real (limitation 8), but
  it is `toStoredValue` behavior; a CSV-only guard would re-split the path this
  branch just merged. Belongs to `inferInput`.

### Round 2 — second pass

Found five more, all applied — decisions 10 to 13 and the `dismissItem`
comment. Pushed back on one:

- *The truncation warning is off by one, because `rowCount` counts the header
  the client prepended.* It counts rows written, and the warning speaks about
  the file, whose first row **is** the header: "the first 8,333 rows" is that
  header plus 8,332 records. Redefining `rowCount` as data records would also
  contradict the three cell-cap tests, which assert it against a budget
  measured in rows written. A test now pins the meaning. (Decision 14 has since
  removed the prepending the finding was aimed at; the count is unchanged,
  because the header is now simply one of the rows the server sends.)

Two of the five could not have been caught by the suite that gated them: the
specs mock the S3 client, so the lifecycle merge and the `NoSuchKey` branch both
passed while being dead in a real deployment (decision 13). Smoke-testing
storage code against real storage is the only thing that finds that class.

### Round 3 — third pass

Raised nine. Each was reproduced against the real DuckDB reader and against
papaparse before deciding; the two fixed are the commits above.

- **A quoted newline threw.** `null_padding` plus DuckDB's parallel scanner is
  an unsupported combination, and an address or description field routinely has
  one. Fixed by `parallel = false`, which DuckDB's own error prescribes.
- **Header text came from DuckDB's column names**, three ways. Fixed by
  decision 14, which also removed the divergence on a header-only file.

Pushed back or recorded instead:

- *Widen `FILE_CONTENT_ERRORS` so the quoted-newline failure is a 400.* The
  allowlist is right as it stands. `IO Error` means the temp file this service
  just wrote is gone, `Binder Error` means its SQL is malformed, `Out of Memory
  Error` means its limits are, and `Parameter Not Allowed Error` — the class
  that fired — means it handed DuckDB an unsupported combination. Those are
  server faults and 500 is their status; the defect was having the bad
  combination, which the first commit removes. Re-labelling a server
  misconfiguration as the caller's bad file is what the existing comment
  already argues against.
- Two more were verified, judged not worth the diff, and are limitations 14
  and 16 above. A third — an oversized first row reporting the empty-file
  message instead of naming the real problem — was judged the same way here
  but has since been closed by a proper "too many columns" error and no
  longer has a row in the table.

### Round 4 — post-rebase pass

After rebasing onto `2d41c1e85`, raised seven. Two were fixed (the commits
above). Three were findings this document had already decided and recorded,
which is worth noting here because a reviewer meeting the branch cold will
land on them again:

- *The header bold depends on file size.* Decision 2's amendment, taken
  deliberately; limitation 13 states the cost.
- *`MissingQuotes` is fatal on the client but DuckDB recovers.* Decision 5. The
  backend spec covering it says so in as many words — "Documented rather than
  forced into agreement" — because making DuckDB strict would reject files it
  reads perfectly well.
- *A leading blank line is dropped on one path.* Limitation 16.

The seventh is limitation 15: the cell cap does not bound bytes. Real, and
deferred rather than dismissed — the fix is a second budget whose constant has
to be measured, not estimated inside a review round.

## Follow-up

- **The client/server size split (decision 6, `#554`/`#555`) has a hard ceiling
  to design against, not just a memory-cost curve.** `CLIENT_PARSE_MAX_BYTES`
  (25 MB) was picked from measured heap cost (~7x file size), but underneath
  that there is a wall independent of any budget: V8 caps a JS string at
  ~1 GiB on 64-bit builds (historically documented as ~512 MB, still the
  practical figure on the 32-bit/mobile builds Wafflebase also has to run
  on — see [MDN's `String.length` browser-compatibility
  table](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/length#browser_compatibility)).
  A file whose decoded text exceeds that cannot be read by `File.text()` (CSV)
  or an equivalent whole-string decode at all — no heap tuning fixes it, the
  read throws. Parquet is binary and JSON has no line-oriented streaming
  parser in this codebase yet, so neither inherits `CLIENT_PARSE_MAX_BYTES`
  as-is, but whoever sizes their own client/server threshold should check it
  against the same wall rather than only against a memory budget.
- **CP949 / EUC-KR support** (limitation 1), the one follow-up with a decision
  attached — see Open questions. Researched after the fact, and the cost is
  lopsided:
  - *Client, no dependency.* `TextDecoder` ships `euc-kr`, and UTF-8 is its own
    detector — CP949 bytes are almost never valid UTF-8, so
    `new TextDecoder('utf-8', { fatal: true })` throwing **is** the signal.
    Roughly five lines, once `importCsvFile` reads `arrayBuffer()` instead of
    `text()`.
  - *Server, not cheap.* DuckDB reads `utf-8`/`utf-16`/`latin-1`; `cp949` needs
    the `encodings` extension — 352 MB, fetched at runtime — and this service
    sets `autoload`/`autoinstall` to `false` precisely because it parses
    untrusted uploads. Measured against our own settings: `The CSV Reader does
    not support the encoding: "cp949"`.
  - *So fix both or neither.* Client-only would import a 20 MB CP949 file
    correctly and mojibake a 30 MB one — the size-dependent divergence this
    branch spent four rounds removing.
  - *The shape that works:* transcode to UTF-8 while streaming the staged blob
    to its temp file, leaving DuckDB on UTF-8. No extension, no dependency. The
    chunk-boundary hazard (a split multi-byte character decoding to U+FFFD) is
    already solved in `packages/frontend/src/api/ndjson.ts` with
    `decode(chunk, { stream: true })` — reuse that, do not re-derive it.
- **`inferInput` numeric precision and date formats** (limitations 7, 8) — both
  belong there so typing, pasting and importing keep agreeing.
- **Connect for files over the cap** (FI-4 → FI-5). The preview response is
  already `{ columns, rows }`, which is what `loadQueryResults` consumes, so a
  read-only tab reuses the backend path unchanged and skips materialization
  entirely. That is the real answer to limitation 5.
- **Dead `pending-imports.ts` trio** (spreadsheet / docs / slides) —
  `setPendingImport` has zero callers, ~60 lines.
- **The `fast-xml-parser` override deserves its own report** (decision 13). It
  broke every XML-parsing S3 call repo-wide — `ListBuckets` and `ListObjectsV2`
  as readily as the lifecycle read — and CSV import only happened to be the
  first code to make one. The commit carries the reproduction: the SDK's
  `addEntity('#xD')`, the version matrix (5.5.8 parses, 5.7.0 and 5.7.1 throw,
  5.7.3 on works), and the MinIO transcript. Fine to split out if the
  maintainer prefers the dependency change on its own.
- **A byte budget beside the cell budget** (limitation 15). `MAX_IMPORT_CELLS`
  is the right unit for ordinary values and the wrong one for long text. Needs
  `Document.getDocSize` measured over wide-text cells to pick the constant, then
  `importTable` stopping at whichever budget binds first.
- **Client-side header sniffing** (limitation 13) would close the last
  behavioral difference between the two paths. It needs a rule narrow enough
  not to be the heuristic decision 2 rejected — "row 1 is entirely numeric"
  would cover the common case without claiming to detect headers in general.

### Docs this branch makes stale

Deliberately **not** edited here. These are the maintainer's to sync — the same
pass `20260802-design-doc-audit-findings.md` did across 27 design docs — and
rewriting a design proposal from a feature branch would put a second review axis
on this PR. Listed so nobody has to rediscover them; happy to follow up in a
separate PR.

- **`packages/backend/README.md`** — the only one that documents *this* code
  rather than a proposal, so the strongest candidate to fold in if the
  maintainer prefers. Missing `POST /workspaces/:wid/file-imports/upload` and
  `…/preview` from the endpoint tables, and `file-import/` + `lakehouse/` from
  the module tree.
- **`docs/design/sheets/file-import.md`**
  - `:29` — the CSV row of "Current state" reads "⚠️ **Not wired** —
    `papaparse` is already a dependency of `@wafflebase/sheets` but unused".
    Both halves are now wrong: CSV ships, and papaparse was a *dev*Dependency
    until this branch moved it (`61101e7de`), which is what finally made that
    sentence true.
  - §2 proposes extracting `createSpreadsheetDocumentFromImportedSheets` from
    the XLSX builder. Not needed — `createSpreadsheetDocument` was already
    exported and already used by the backend, so `xlsx-actions.ts` is untouched.
  - §3 proposes extracting a generic `StorageService`; `FileService` was reused
    instead. It also names `read_csv_auto`, where the shipped reader is
    `read_csv` with `all_varchar` + `null_padding` (both load-bearing).
  - §6's matrix still marks CSV/TSV small and large as ➕ proposed.
  - The Risks row "S3 temp storage growth" is now an actual lifecycle rule,
    merged into whatever else the bucket carries (decision 10).
- **`docs/tasks/active/20260625-sheets-file-import-todo.md`** (the epic) — FI-1's
  four boxes and its acceptance are met; its first box ("Generalize the document
  builder") turned out unnecessary for the reason above. FI-5's materialize cap
  landed here while its Connect half still waits on FI-4. `:28` still names the
  deleted `pickAndImportXlsx`.
- **`docs/design/README.md`** `:24` — the index line describes CSV as something
  the doc "adds"; it now ships.

## Open questions

- **CP949 support: this PR, or a separate issue?** For the maintainer, because
  it is a call about review load and about Korean users, not about the code.
  Not checking the encoding story before settling on `File.text()` was my miss:
  that one choice decided the encoding behavior of the whole feature and I made
  it without looking at what it excluded. The argument for deferring is that the
  server half lands in the upload path this branch already rewrites (categories,
  workspace-scoped keys, streamed read), and stacking it on mid-review is the
  wrong trade. The argument against is that it ships UTF-8-only in the meantime.
  Details and the measured costs are in Follow-up.
- **Tab name: keep `Sheet1` or use the filename?** Excel and Google Sheets use
  the filename; FI-1 does not ask for it and the document title already carries
  it. One frontend line (`createSpreadsheetDocument({ tabName })`).
- **Import CSV into an already-open spreadsheet as a new tab** — out of scope
  here; that path cannot use `applyImportedContent`'s whole-document replacement
  and needs `Store.setGrid` inside `beginBatch`/`endBatch`.

## Wrap-up checklist

- [ ] File the `inferInput` issue (limitations 7 and 8) and the `ensureAxisLength`
      follow-up; decide whether the `fast-xml-parser` fix travels with this PR.
- [ ] Open the PR (title ≤70 chars); fill in the `PR:` line above, and carry the
      "Docs this branch makes stale" list from Follow-up into the body.
- [ ] After the PR: write `20260725-sheets-csv-import-lessons.md`, so review
      findings land in it too.
- [ ] After merge: `pnpm tasks:archive && pnpm tasks:index`.
