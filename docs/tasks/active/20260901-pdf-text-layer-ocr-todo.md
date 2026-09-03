# PDF & Image Text — Selection, Copy, and Machine Reads

Design: [`docs/design/ocr.md`](../../design/ocr.md)

Three additive phases. Each is independently shippable; P0 and P1 are worth
doing even if P2 never lands.

## P0 — Text layer (no OCR) — done, this branch

Make text in a text-bearing PDF selectable/copyable/findable. No new
dependencies: `pdfjs-dist@6.1.200` is installed and exports `TextLayer`.

- [x] Design doc + README entry
- [x] `packages/frontend/src/app/files/pdf-text-layer.css` — scoped copy of the
      ~40 lines of pdf.js `.textLayer` rules under a `wb-` prefix; imported
      from `src/index.css` (the `notes-preview.css` convention)
- [x] `pdf-viewer.tsx` — mount `TextLayer` between the canvas and the overlay
      in `PdfPageView`
  - [x] render once per page at `scale: 1`; resize updates only
        `--total-scale-factor` (span positions are `rawDims` percentages)
  - [x] own the container's size + rotation transform rather than pdf.js's
        `setLayerDimensions` (its `round(…, var(--scale-round-x))` is invalid
        outside the full pdf.js viewer)
  - [x] cancel in flight on unmount; treat any failure as non-fatal so the
        page still rasterizes
  - [x] load pdf.js **once** in `PdfViewer` and hand it to each page — N
        concurrent `await import()`s of one module also raced under test,
        handing one page the mock and another the real class
- [x] Tests — geometry per rotation; composition with `PdfCommentLayer`
      (idle drag → text layer, `creating` drag → `pdf-region-capture`);
      resize does not re-fetch text content; empty text content is silent
- [x] `pnpm verify:fast`
- [ ] Manual smoke in `pnpm dev`: drag + ⌘C + ⌘F on a text PDF; a scanned PDF
      degrades silently; region comments still work

Not in P0: anything OCR, and anything backend.

## P0.5 — Comment on selected text — done, this branch

Falls straight out of the text layer: PDF comments could only anchor to a
hand-drawn rectangle, which made "this sentence is wrong" a drawing exercise.
Design: [`docs/design/pdf.md`](../../design/pdf.md) Phase 3.

- [x] `PdfTextAnchor` (`rects[]` + `quote`) joins the `CommentAnchor` union;
      `PdfAnchor` widens every generic position
- [x] Store copies both anchor kinds field by field (a spread would carry
      Yorkie proxies out of the CRDT)
- [x] `normalizeClientRects` — one box per line, degenerate/duplicate boxes
      dropped, clamped, page-relative
- [x] `usePdfTextSelection` — settles on `pointerup`/`keyup`, stands down for
      read-only and while the region tool is armed
- [x] Affordance + composer positioned in page percentages; composer echoes
      the quote
- [x] Multi-rect highlights; pin at `anchorBounds`
- [x] Region tool kept and relabelled ("Comment on a region") for scans,
      figures, and table whitespace
- [x] Tests: 16 selection/geometry, 5 rect/bounds, 2 store round-trip, 7
      end-to-end flow through a real local Yorkie doc

### Fixed after the first pass on a real document

Found by reading an actual LaTeX PDF, not by testing:

- [x] Typeset fragments joined back into line bands. A PDF has no text lines;
      pdf.js emits a span per run, so `n₁n₅ → o₂` arrived as a dozen pieces
      and the highlight was a row of chips around the subscripts. Grouped by
      vertical overlap, joined while the gap stays under `MAX_JOIN_GAP` — so
      a two-column page still highlights as two bands, not one across the
      gutter
- [x] Posting a comment no longer forces the side panel open
- [x] A panel row scrolls to its thread (`scrollToAnchor`) — `onJumpTo` only
      set the active id and never moved the viewport
- [x] Pins shrunk (20px → 14px) and translucent until hovered or open
- [x] Tests for all three; the scroll and selection-collapse tests were each
      confirmed to fail with their fix reverted

### Known limitation

Joining cleans up a selection that is already correct. It does not fix the
browser selecting only part of a heavily-positioned run — a pdf.js text-layer
behaviour, not ours. If that shows up in practice it needs a different
approach (hit-testing spans rather than trusting `Selection`).

## P1 — Extraction over API + CLI

- [ ] `unpdf` (MIT) in the backend
- [ ] `GET /documents/:id/text` on `document-file.controller.ts` — inherits
      that controller's member-or-share-token guard unchanged
- [ ] Response `{ pages: [{ index, text, source }], totalPages, source }` —
      provenance per page, document-level `source` a summary
      (`embedded`/`ocr`/`mixed`), since one PDF mixes typeset and scanned pages
- [ ] Bounds independent of the 50 MB upload cap: page cap → 413 before
      parsing, explicit `maxImageSize` (~16 MP) instead of unpdf's unlimited
      default, hard extraction timeout → 504
- [ ] `GET /api/v1/workspaces/:wid/documents/:did/text`
- [ ] `wafflebase files text <doc-id> [--page N] [--json]`
- [ ] Cache by `fileId` (immutable — blobs are never rewritten)
- [ ] Tests: per-page text + per-page `source`; the five access-gate cases
      mirroring `GET /documents/:id/file`; each of the three bounds on a
      small fixture; CLI shape; non-blob type rejected

## P2 — OCR

Blocked on a decision, not on code: **this backend has no job queue**
(no bull/bullmq, no `@nestjs/schedule`). P2 introduces the first
background-work boundary, and that is its real cost.

- [ ] Confirm PP-OCRv5 **model weight** licence (separate from the package
      licence) before baking weights into a published image
- [ ] `OcrEngine` seam (`recognize(image, opts) → OcrPage`), à la
      `SpellChecker` in docs-spell-check
- [ ] Engine: `ppu-paddle-ocr` + `onnxruntime-node` (Korean quality decides
      this over `tesseract.js`)
- [ ] Models baked at build time + `--network none` CI smoke, copying the
      lakehouse DuckDB-extension pattern
- [ ] Job boundary: `POST /documents/:id/ocr` → `pending` row → in-process
      worker with `FOR UPDATE SKIP LOCKED` claim → SSE completion via the
      notifications hub
- [ ] Authorize the POST with the same member-or-share-token check as
      `GET /text` **before** the row is written (throttling is not access
      control), and require an authenticated identity to initiate
- [ ] Claim is a lease, not a flag: `leaseExpiresAt` + heartbeat, expired
      lease reclaimable by any replica (same predicate recovers on startup),
      `attempts` bounds the retry — else a crash locks the document out
      forever via the unique `documentId`
- [ ] Prisma row (`documentId` unique, `status`, `engine`, `lang`,
      `pageCount`, `error`, `leaseExpiresAt`, `attempts`) +
      `<fileId>.ocr.json` sidecar in `wafflebase-files`
- [ ] Normalized 0–1 rects — same convention as `pdf-region` comment anchors
- [ ] Viewer: populate the P0 text layer from `OcrPage.words` when a page has
      no embedded text; same overlay for `ImageViewer`
- [ ] `GET /documents/:id/text` answers `source: "ocr"` per page — no client
      change
- [ ] Unfinished-job contract on that route: always `200` with the pages it
      can serve, an `ocr: { status, error? }` field, awaiting pages present
      with `text: ""` so indexes stay aligned
- [ ] Throttle via `UserThrottlerGuard`; never automatic on upload; page cap
- [ ] Tests: rect round-trip; rotated/deskewed fixture lands on glyphs; job
      lifecycle incl. duplicate suppression; crash-after-claim reclaim **and**
      a heartbeat keeping a live claim from being stolen; enqueue refused for
      a caller who cannot read the document and for an anonymous token
      holder; `GET /text` during pending/running/failed; image → single page
