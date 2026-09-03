---
title: pdf-image-text
target-version: 0.7.0
---

<!-- Make sure to append document link in design README.md after creating the document. -->

# PDF & Image Text — Selection, Copy, and Machine Reads

## Summary

A PDF or image document in wafflebase is today a picture. `PdfViewer`
rasterizes each page to a `<canvas>` and stops there, so **nothing in a PDF
can be selected, copied, or searched** — not even a PDF whose text is
already present in the file. `ImageViewer` is a bare `<img>`. Nothing in
either type is readable by the backend, the REST API, the CLI, or an agent:
`wafflebase files download` hands back opaque bytes.

This document closes that gap in three phases, and the first one needs no OCR
at all.

The decisive fact is that "make PDF text selectable" and "OCR" are **two
different problems** that get conflated:

| Source | What it needs | Cost |
| ------ | ------------- | ---- |
| A PDF with a text layer (anything exported from Word, 한글, LaTeX, Chrome print-to-PDF) | Nothing new. pdf.js already parses the glyphs *and their positions* while rendering; we throw that away. | One DOM layer, zero new dependencies |
| A scanned PDF, a photo, a screenshot | Real OCR — a detection + recognition model | Models, inference, a job boundary |

The first row is the majority of documents people upload, and it is currently
broken for a reason that has nothing to do with OCR. So:

- **P0 — Text layer (no OCR).** Overlay pdf.js's own `TextLayer` on each
  rendered page. Drag-select, ⌘C, and browser ⌘F start working on every
  text-bearing PDF. New dependencies: **none** — `pdfjs-dist@6.1.200` is
  already installed and already exports `TextLayer`.
- **P1 — Extraction API.** `GET /documents/:id/text` on the backend, backed
  by `unpdf` (MIT, a serverless redistribution of the same pdf.js). Exposes
  the same text to the REST API, the CLI, and agents.
- **P2 — OCR.** For scanned PDFs and images, produce the text layer that the
  file lacks, normalize it into the same shape P0 and P1 already consume, and
  persist it as a sidecar.

The phases are strictly additive and each is independently shippable. P0 and
P1 are worth doing even if P2 is never built.

### Goals

- **P0** — Text in a PDF page is selectable with the mouse, copyable with
  ⌘C, and findable with the browser's own ⌘F. Selection highlights land on
  the glyphs the user sees.
- **P0** — Do not disturb the existing region-comment flow
  (`docs/design/pdf.md` Slice 3), which uses drag on the same pixels.
- **P1** — A document's text is readable over `/api/v1` and from
  `wafflebase files text <doc-id>`, with per-page structure preserved.
- **P2** — A scanned PDF or an uploaded image gains the same three
  capabilities: selection in the viewer, extraction over the API, and copy.
- **P2** — OCR geometry is stored in the *same normalized 0–1 page-relative*
  coordinate convention already used by PDF comment anchors
  (`CommentAnchor` / `pdf-region`), so one convention covers pins, highlights
  and OCR words.

### Non-Goals

- **Writing OCR text back into the PDF bytes.** The "searchable PDF" format
  (invisible text render mode 3 superimposed under the scan) is how Acrobat
  and `tesseract --pdf` ship OCR. We deliberately do not mutate the stored
  blob: `docs/design/pdf.md` states PDFs are view-only and comments never
  touch the bytes, and re-writing the file would invalidate every existing
  `fileId`, every share link's cached bytes, and every region anchor. We
  store OCR *beside* the blob instead. A "download as searchable PDF" export
  is a plausible later feature, not a prerequisite.
- **Layout, table, or form understanding.** OCR here means "words and where
  they are". Reading order beyond pdf.js's own, table reconstruction, and
  key-value extraction are out.
- **Handwriting.** None of the candidate open-source engines is good enough
  at it to promise.
- **Translation, summarization, or any LLM pass** over the extracted text.
  This document delivers text; what consumes it is someone else's design.
- **Editing recognized text.** OCR output is a read-only derivative of the
  blob, regenerable at any time. It is never authoritative and never a CRDT.
- **`GET /images/:id` and the inline sheet/docs image path.** This covers
  `pdf` and `image` *documents* only.

## Proposal Details

### P0 — The text layer (no OCR)

#### Why this is nearly free

pdf.js separates rasterization from text. `page.render()` paints pixels;
`page.getTextContent()` returns every text run with its transform. The stock
Firefox PDF viewer combines them by absolutely positioning one transparent
`<span>` per run over the canvas — the pixels are the picture, the spans are
the selection. `pdfjs-dist` exports the class that does this as `TextLayer`
(confirmed at `types/src/pdf.d.ts:68` in the installed 6.1.200).

Reading the v6 implementation settles the one thing that decides how hard
this is in *our* viewer. `PdfViewer` is deliberately fluid — pages are
`width: 100%` with an `aspect-ratio` placeholder, so a window resize or a
sidebar toggle reflows instantly in CSS and only *then* re-rasterizes at
higher resolution (`pdf-viewer.tsx:56-64`). A text layer positioned in
absolute pixels would fight that on every resize.

It is not positioned in pixels. `TextLayer#appendText` sets

```js
divStyle.left = `${(100 * left / this.#pageWidth).toFixed(2)}%`;
divStyle.top  = `${(100 * top  / this.#pageHeight).toFixed(2)}%`;
divStyle.setProperty("--font-height", `${fontHeight.toFixed(2)}px`);
```

where `#pageWidth`/`#pageHeight` come from `viewport.rawDims`, which is the
**unscaled viewBox** (`pageWidth: dims[2] - dims[0]`) and therefore
independent of `viewport.scale`. Span positions are percentages of the page
box; only the font size is absolute, and it is scaled by a single CSS
custom property:

```css
--text-scale-factor: calc(var(--total-scale-factor) * var(--min-font-size));
font-size: calc(var(--text-scale-factor) * var(--font-height));
```

So the text layer is rendered **once per page, at scale 1**, and every
subsequent resize is one number: `--total-scale-factor = displayWidth /
unscaledPageWidth`. That is exactly the CSS-first contract the viewer already
follows for its canvases. No re-render on resize, no debounce, no second
`getTextContent()`.

#### Where it goes

`PdfPageView` (`pdf-viewer.tsx:198`) already stacks a canvas and an optional
`overlay` inside a `position: relative` wrapper. The text layer becomes the
middle stratum:

```
<div ref={wrapRef} class="relative" style={aspect-ratio}>   ← sized by CSS
  <canvas />                                                ← pixels
  <div class="wb-pdf-text-layer" />                         ← NEW: selection
  {overlay}                                                 ← comment pins
</div>
```

The stacking order is what makes this compose with region comments instead of
breaking them. `PdfCommentLayer`'s root is `pointer-events-none`, and only
two things inside it opt back in: the thread pins (always) and the
drag-capture surface (`pointer-events-auto absolute inset-0`, rendered
**only while `creating`** — `pdf-comment-layer.tsx:86-89`). Therefore:

- **Idle** — the capture surface does not exist, pointer events fall through
  the transparent overlay to the text layer, and dragging selects text. Pins
  sit above the text layer and stay clickable.
- **Creating a comment** — the capture surface covers the page above the text
  layer and swallows the drag, so the region rectangle is drawn exactly as it
  is today.

The two features interleave by z-order alone, so `pdf-comment-layer.tsx`
needs no change **for P0**. (It did change later, when Phase 3 of
[`pdf.md`](pdf.md) taught it to draw a highlight per selected line — but
that is new rendering, not a change to how the layers compose.)

#### Page rotation

`rawDims` is the *unrotated* viewBox, so span percentages are relative to the
unrotated page, while the canvas is rasterized from
`page.getViewport({ scale })`, which applies the page's `/Rotate`. For the
common case (`rotation === 0`) they coincide. For 90/180/270 the text layer
is sized to the unrotated box in display pixels and rotated into place about
its top-left corner:

| rotation | container size | transform |
| -------- | -------------- | --------- |
| 0 | `Dw × Dh` | none |
| 90 | `Dh × Dw` | `translateX(Dw) rotate(90deg)` |
| 180 | `Dw × Dh` | `translate(Dw, Dh) rotate(180deg)` |
| 270 | `Dh × Dw` | `translateY(Dh) rotate(270deg)` |

`Dw` is the wrapper's client width and `Dh` follows from the rotated
aspect ratio. Both the size and `--total-scale-factor` are written by the
same code path, so they can never disagree. We take over sizing rather than
leaving it to pdf.js's `setLayerDimensions`, which emits
`round(down, var(--total-scale-factor) * Npx, var(--scale-round-x))` against
a `--scale-round-x` that only the full pdf.js viewer defines — a declaration
that would be invalid here and silently drop.

#### CSS

pdf.js's `web/pdf_viewer.css` carries the rules that consume `--font-height`,
`--scale-x` and `--rotate`, but it also carries the annotation layer, the
editor layers, the sidebar, and a set of unprefixed class names. We copy the
~40 lines that the text layer needs into
`packages/frontend/src/app/files/pdf-text-layer.css` under a `wb-`-prefixed
class, imported from `src/index.css` — the same convention
`app/notes/notes-preview.css` already uses. Critically the spans keep
`color: transparent` (the canvas underneath is the visible text) with a
translucent `::selection` background, which is what makes an invisible layer
feel like selectable text.

#### What P0 does not fix

A scanned PDF has no text content, so `getTextContent()` returns nothing and
the page stays unselectable — correctly, and with no error. That is P2's job.
The viewer surfaces this honestly rather than looking broken: a page that
yields zero text runs is recorded, and when *no* page in the document yields
any, the header can offer OCR (P2) instead of silently doing nothing.

### P1 — Extraction over the API and CLI

Same engine, other side of the wire. `unpdf` (MIT, zero dependencies) is
pdf.js repackaged for server and edge runtimes; using it keeps the backend's
extraction byte-identical to what the viewer shows, which matters because a
user who copies from the viewer and an agent that reads over the API must not
get different text.

- **`GET /documents/:id/text`** — new route in the existing
  `document-file.controller.ts`, so it inherits that controller's access
  rule unchanged: `OptionalJwtAuthGuard`, member **or** valid unexpired
  `?token=` share link, `link.documentId === id`. Reusing the controller is
  the point — a parallel permission implementation is exactly the drift
  `docs/design/pdf.md` rejected for file serving.
- **Response** — `{ pages: [{ index, text, source }], totalPages, source }`.
  Per-page, not one blob: page numbers are how people cite PDFs, and the
  region-comment anchors are already page-indexed. **Provenance is per page**,
  because a single PDF routinely mixes typeset pages with scanned inserts and
  the viewer already treats it that way (P2 populates the text layer from
  `getTextContent()` or from `OcrPage.words` *per page*). A page's `source` is
  `"embedded"` (exact) or `"ocr"` (approximate); the document-level `source`
  is a summary — `"embedded"`, `"ocr"`, or `"mixed"` — and a consumer that
  cares about exactness reads the page. Collapsing this to one document-level
  label would tell an agent that a 200-page contract is exact because 199 of
  its pages are.
- **`GET /api/v1/workspaces/:wid/documents/:did/text`** — the v1 mirror,
  alongside the existing files routes.
- **CLI** — `wafflebase files text <doc-id> [--page N] [--json]`, next to
  the `upload`/`download` pair already in `packages/cli/src/commands/files.ts`.

Extraction needs no model, so it runs inline in the request — but the 50 MB
upload cap is **not** what bounds it. Cost scales with page count and with the
declared dimensions of embedded images, neither of which is a function of file
size: a few-hundred-kilobyte PDF can declare tens of thousands of pages or a
single gigapixel image, and `unpdf` documents that its own hardening is the
caller's job. Since the backend parses on the event loop, an unbounded parse
does not merely make one request slow, it stalls the process. So the route
carries its own three bounds, checked before extraction and independent of
upload size:

- **Pages** — read `numPages` first and refuse a document over the cap
  (`413`) rather than starting a parse that will be abandoned.
- **Image dimensions** — pass an explicit `maxImageSize` (~16 megapixels)
  instead of `unpdf`'s unlimited default, which is the decompression-bomb
  path.
- **Wall clock** — race extraction against a hard timeout and answer `504`,
  so a pathological document cannot hold a worker indefinitely.

If those limits turn out to reject documents users legitimately have, the
answer is to move extraction behind the same bounded background work P2
introduces — not to raise them until the process is unprotected again.

Results are cached by `fileId` (immutable, since a document's blob is never
rewritten) so repeated agent reads do not re-parse.

### P2 — OCR

#### Engine choice

Surveyed against three constraints: it must be usable from TypeScript, its
licence must be compatible with this repository's **Apache-2.0**, and it must
be maintained.

| Package | Version | Licence | Last publish | Verdict |
| ------- | ------- | ------- | ------------ | ------- |
| `tesseract.js` | 7.0.0 | Apache-2.0 | 2025-12 | Viable. Same licence as this repo, runs in both browser and Node as WASM, 100+ languages. Weak on Korean, and upstream commits have slowed. |
| `ppu-paddle-ocr` | 6.4.3 | MIT | 2026-08 | **Preferred.** PP-OCRv5 via ONNX Runtime; materially better on Korean and on dense/receipt-like layouts, actively released. |
| `onnxruntime-node` | 1.29.0 | MIT | 2026-08 | Runtime for the above. |
| `@gutenye/ocr-node` | 1.4.8 | MIT | 2024-12 | Rejected — unmaintained for ~2 years. |
| `@paddlejs-models/ocr` | — | — | stale | Rejected — browser-only, PP-OCRv4, abandoned. |
| `mupdf` | — | **AGPL-3.0** | — | Rejected on licence. The network-service clause is incompatible with shipping this as a hosted service under Apache-2.0. |

Korean quality is the deciding axis, not a detail: Tesseract's `kor`
traineddata degrades badly on mixed Hangul/Latin and on vertical text, which
is a large share of what this deployment will see. PP-OCRv5 is trained for
it.

The engine sits behind an `OcrEngine` interface (`recognize(image, opts) →
OcrPage`) so the choice is reversible and so a hosted OCR service can be
substituted by a deployment that wants one — the same seam
`docs/design/docs-spell-check.md` uses for `SpellChecker`.

#### Where inference runs

**Backend**, not the browser. A browser-side pass would need no new server
infrastructure and is tempting, but it makes the result a function of whoever
happened to open the document — the API and CLI (the whole point of P1/P2)
would return text only if some user had previously opened the file in a tab.
Server-side keeps one answer per document.

Two consequences have to be designed for rather than discovered:

- **There is no job queue.** `packages/backend/src` has no bull/bullmq and no
  `@nestjs/schedule`; every module is request-scoped. OCR of a 200-page scan
  is minutes of CPU and cannot run inside an HTTP request. P2 therefore
  introduces the first background-work boundary in this backend, and that —
  not the model — is its real cost. The narrowest version that works: a
  `POST /documents/:id/ocr` that records a `pending` row and returns
  immediately, an in-process worker draining it with bounded concurrency, and
  the existing SSE machinery from `docs/design/notifications.md` reused to
  push completion. Two details of that are load-bearing rather than
  incidental:

  - **Authorization runs before the row is written**, not just before the
    result is served. `POST /documents/:id/ocr` reuses the same access check
    as `GET /documents/:id/text` — member, or a valid unexpired `?token=`
    whose `link.documentId === id` — so a caller cannot enqueue work against
    a document they cannot read. Throttling is not an access control: a
    per-user quota still lets an authenticated user spend it on *other
    people's* documents. On top of that access check, **initiating** OCR
    requires an authenticated identity: an anonymous share-link holder can
    read OCR text that already exists but cannot start a job, because the
    cost control is `UserThrottlerGuard` and an anonymous trigger gives it
    nobody to key on.
  - **The claim is a lease, not a flag.** Multi-replica correctness comes
    from a `SELECT … FOR UPDATE SKIP LOCKED` claim on the row, the same way
    the notification hub tolerates replicas without Redis — but the OCR work
    itself runs for minutes *outside* any transaction, so a process that dies
    mid-recognition would leave `running` set forever and, with one job per
    document enforced by the unique `documentId`, permanently lock that
    document out of OCR. The claim therefore writes a `leaseExpiresAt` the
    worker extends on a heartbeat while it works, and a row whose lease has
    expired is claimable again by any replica; the same predicate is what
    recovers rows on startup, so no separate sweeper exists to forget. An
    attempt counter bounds the retry so a document that reliably kills the
    worker ends `failed` rather than cycling.
- **Model binaries ship in the image.** ~10–80 MB of ONNX graphs must be
  present without egress at runtime. There is a precedent to copy exactly:
  the lakehouse connector bakes ~170 MB of DuckDB extensions into the
  production image at build time and CI proves it with a `--network none`
  smoke test (`packages/backend/README.md`). OCR models follow that pattern —
  downloaded at build, `LOAD`-equivalent verified at build, so a broken image
  fails in CI rather than on a user's first scan.

#### Storage

OCR output is a **derivative**, not user content: regenerable from the blob,
never edited, never merged. So it is not a CRDT, and Yorkie is the wrong
home — the same reasoning that keeps PDF bytes out of Yorkie in
`docs/design/pdf.md`.

- **Payload** → a sidecar object in the existing `wafflebase-files` bucket,
  keyed `<fileId>.ocr.json`. It rides the bucket, prefix, and lifecycle of
  the blob it describes, so deleting a document's blob disposes of it by the
  same code path.
- **State** → a small Prisma row (`documentId` unique, `status`, `engine`,
  `lang`, `pageCount`, `error`, `leaseExpiresAt`, `attempts`, timestamps).
  Status needs a database; the payload does not.

The payload shape is the contract P0 and P1 already read:

```ts
type OcrWord = { text: string; rect: { x; y; w; h } };  // normalized 0–1
type OcrPage = { index: number; width: number; height: number; words: OcrWord[] };
```

`rect` is normalized 0–1 page-relative **because that is already the
convention** — `CommentAnchor`'s `pdf-region` variant chose it so pins survive
any zoom or render scale (`docs/design/pdf.md`). OCR words inherit the
property for free, and the P0 renderer can position OCR spans with the same
percentage arithmetic pdf.js uses, from the same numbers.

#### Serving it back

- **Viewer** — when a page has no embedded text but the document has OCR, the
  P0 text layer is populated from `OcrPage.words` instead of
  `getTextContent()`. One layer, two sources; selection and copy behave
  identically.
- **API / CLI** — `GET /documents/:id/text` answers with `source: "ocr"` on
  the pages OCR produced. Nothing about the *page* shape changes, so the CLI
  and any agent written against P1 gain scanned documents without a client
  change.

  An unfinished job is the one case P1's contract does not already cover, so
  it is defined rather than left to whatever the first implementation does.
  The route always answers `200` with the pages it can serve — a document
  with embedded text on some pages must not become unreadable because OCR of
  the others is queued — and reports the job alongside them in an `ocr`
  field: `{ status: "pending" | "running" | "failed" | "done", error? }`,
  absent entirely when no job was ever requested. Pages awaiting OCR are
  present with `text: ""` and their own `source: "ocr"`, so page indexes stay
  aligned with the document and a caller never has to infer which pages are
  missing. `failed` carries the reason and is terminal until the caller asks
  again; it is not an HTTP error, because the pages that *did* extract are
  still good. Completion arrives over the SSE stream, so a client polls only
  if it wants to.
- **Images** — `ImageViewer` gets the same absolutely-positioned span overlay
  over its `<img>`. It has no pdf.js involvement; it consumes the same
  `OcrPage` with a single page.

## Risks and Mitigation

- **Misaligned selection (P0/P2).** The single most-reported OCR-viewer
  defect, and it is almost always a coordinate-space bug rather than a
  recognition one. P0 avoids it structurally by using pdf.js's own geometry
  rather than re-deriving it. P2 must store word boxes in the **unrotated,
  un-deskewed** page space of the rendered image; any deskew applied to
  improve recognition has to be inverted before the boxes are stored, or
  selection drifts from the glyphs.
- **Text layer breaks region comments (P0).** Mitigated by z-order plus the
  fact that the comment layer's capture surface is mounted only while
  `creating`. Guarded by a test asserting the capture surface still receives
  the drag while creating, and that the text layer is beneath it.
- **Rotated pages (P0).** Handled by the explicit rotation transform above
  rather than left undefined. A page with `/Rotate 90` is covered by a unit
  test on the size/transform computation, since the alternative — shipping a
  layer that is silently 90° off — is worse than shipping none.
- **jsdom has no canvas 2D context (P0).** `TextLayer` measures glyphs with
  `canvas.getContext("2d")`, which is null under the frontend's jsdom test
  environment. The viewer must treat a text-layer failure as non-fatal — the
  page still rasterizes and the document still opens — which is also the
  correct production behavior for a malformed text stream.
- **Bundle size (P0).** No new dependency, and `TextLayer` is imported from
  the same dynamically-imported `pdfjs-dist` chunk the viewer already lazy
  loads, so the chunk gate (`FRONTEND_CHUNK_LIMIT_KB`) sees a CSS file and
  nothing else.
- **OCR cost and abuse (P2).** OCR is orders of magnitude more expensive than
  any other endpoint. Mitigations: it is never automatic on upload — a user
  or an API caller asks for it; one job per document (the unique
  `documentId`); a page cap; and per-user throttling via the existing
  `UserThrottlerGuard`, which already exists precisely because per-IP
  throttling was too coarse for authenticated work.
- **Model licence drift (P2).** The *code* licence and the *model weights*
  licence are separate. PP-OCR weights must be confirmed Apache-2.0 before
  they are baked into a published image, and recorded in the build step
  alongside the download — the same discipline the font catalog applies in
  `docs/design/slides/slides-fonts.md`.
- **Recognition quality is not a promise.** OCR output is best-effort and
  will contain errors. The API labels each **page**'s `source`, so a consumer
  can tell `embedded` (exact) from `ocr` (approximate) at the granularity a
  mixed document actually varies at, and decide accordingly. We do not present
  OCR text as authoritative anywhere in the UI.

## Testing

### P0

- **Geometry** — `--total-scale-factor` = displayWidth / unscaled page width;
  container size and transform for each of the four rotations.
- **Composition** — with the comment layer mounted and `creating` false, a
  pointer drag reaches the text layer; with `creating` true, it reaches
  `pdf-region-capture` instead and the region ghost still appears.
- **Resize** — growing the wrapper updates the scale factor without
  re-invoking `getTextContent()`.
- **Degradation** — a page whose text content is empty renders no spans and
  logs nothing; a `TextLayer` construction failure leaves the canvas intact.
- **Manual smoke** (`pnpm dev`) — open a text-bearing PDF, drag across a
  paragraph, ⌘C, paste; ⌘F finds a word; then open a scanned PDF and confirm
  it degrades silently rather than erroring.

### P1

- Per-page text from a fixture PDF; `totalPages` matches the document, and
  every page carries its own `source`.
- The access gate: member serves, valid `?token=` serves, expired → 410,
  token for another document → rejected, anonymous non-member → 403. These
  mirror the existing `GET /documents/:id/file` cases because they are the
  same guard.
- The bounds, each on a fixture that is small on disk: a page count over the
  cap → 413 without parsing, an oversized declared image → refused by
  `maxImageSize` rather than allocated, and a parse that exceeds the deadline
  → 504 with the request released.
- CLI `files text` against a fixture, `--json` shape, and a non-blob document
  type rejected.

### P2

- `OcrPage` round-trips through the sidecar with normalized rects intact.
- A rotated / deskewed fixture: stored boxes land on the glyphs in the
  original page space.
- Job lifecycle: `pending → running → done`; a second request for a document
  already `running` does not enqueue a duplicate.
- A crash after the claim: a `running` row whose lease has expired is claimed
  by another worker and the document completes, rather than staying locked
  out by the unique `documentId`. The counterpart too — a live worker's
  heartbeat keeps its row from being stolen mid-recognition — since a lease
  that is only tested one way is a lease that can double-run.
- Enqueueing is refused for a caller who cannot read the document, and for an
  anonymous share-link holder even when the token is valid for it.
- `GET /documents/:id/text` while a job is `pending`, `running` and `failed`:
  `200` each time, embedded pages still served, `ocr.status` reported, and
  awaiting pages present with `text: ""` so indexes stay aligned.
- Image documents produce a single-page `OcrPage`.
