# Lessons — DOCX image import + table-cell image render

Date: 2026-04-12

## 1. JSZip blobs carry no MIME type

`jszip.file(path).async('blob')` returns a `Blob` with `type === ''`.
When such a blob is appended to `FormData` and POSTed, multipart
`Content-Type` defaults to `application/octet-stream` — which the backend
image allowlist rejects outright. Any producer code that forwards a JSZip
blob to an upload endpoint must repackage it with a concrete MIME derived
from a trusted source (here: the `.rels` target extension inside the
`.docx`).

**Apply when**: touching any code that reads media out of a zip-based
container (`.docx`, `.xlsx`, `.odt`, `.epub`, `.zip` attachments) and
hands it off to anything that sniffs Content-Type.

## 2. Two rendering paths means two image branches

`doc-canvas.renderRun()` had a proper `if (style.image)` branch that
called `drawImage`, but `table-renderer.renderTableContent()` — a parallel
code path for the *same* layout run type — did not. Image inlines were
silently painted as the ORC placeholder glyph (`\uFFFC`). Tests on the
body path were green, the regression was invisible until a real `.docx`
with an in-table image showed up.

**Apply when**: adding a new inline style (image, embed, chart, equation,
sticker) to the doc model. Grep for every place that iterates
`line.runs` and branches on `run.inline.style.*` — there are currently
**two** such loops (body + table). Either consolidate them, or patch both
at once and add a regression test that exercises the style inside a
table cell.

## 3. Module-local caches silently fork behavior

`getOrLoadImage` + `imageCache` started as a `doc-canvas.ts` module-local
helper. That was fine when only one file drew images; as soon as a second
renderer needed it, "just duplicate the helper" would have produced two
disjoint caches and double the network load. Extracting it to
`view/image-cache.ts` before wiring the second caller kept the cache
coherent.

**Apply when**: a module-level singleton (cache, registry, pool) is about
to be referenced by a second file. Move it to a shared module *first*,
then import from both sites. Don't let the "quick copy" tempt you.

## 4. Puppeteer scroll-by-guessing is fine for one-off verification

For this bug I needed to eyeball three images deep inside a 36-block,
20-row-table document. Rather than wiring an API to ask the editor "what
scrollTop shows block[5] row 15?", I dumped `doc.blocks[i].type` + the
first-column labels of the target table, inferred the right region, and
scrolled the viewport in 400-800px steps. Total time ~2 min — much faster
than instrumenting the layout.

**Apply when**: you need to visually verify a render bug in a long doc.
Dump the high-level structure first (block types, row labels, block[i]
offsets if available), use that to steer the scroll, and take
screenshots at each candidate position. Don't invest in a "find block in
layout" helper unless you'll reuse it.
