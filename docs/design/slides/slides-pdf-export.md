---
title: slides-pdf-export
target-version: 0.5.0
---

<!-- Make sure to append document link in design README.md after creating the document. -->

# Slides PDF Export (P0 — raster, one slide per page)

## Summary

Slides ships a **raster PDF exporter**
(`packages/slides/src/export/pdf.ts`). The docs pipeline (`PdfExporter`
/ `PdfPainter`) is built for paginated rich text + tables + images, not
for the free-position element model that Slides uses (100+ `ShapeKind`
values, connectors, freeform paths, effects, rotations, groups), so
rebuilding a vector painter for every slide element type would be a
large, high-risk effort.

Instead, the shipped P0 exporter renders each slide to a high-DPI
offscreen canvas with the *existing* `drawSlide()` pipeline — which
already paints every element type with full theme resolution and
effects — then embeds one bitmap per page into a `pdf-lib` document.
The page **width** is fixed at 13.333" (960 pt); the **height** follows
the deck's aspect ratio (`deckSlideHeight(doc.meta) / SLIDE_WIDTH ×
960 pt`), so the default 16:9 deck is 13.333" × 7.5" and a 4:3 deck is
13.333" × 10". This is pixel-identical to the on-screen editor for
minimal effort.

Trade-off accepted: PDF text is not selectable and files are larger
than vector. A future P1 can overlay vector text from the docs
`PdfPainter` on top of the raster background for selectable text; the
P0 module is structured so that overlay can be added without rework.

## Goals / Non-Goals

### Goals (P0)

- Export the full presentation to a multi-page PDF, **one slide per
  page**, page width fixed at 13.333" (960 pt) and height derived from
  the deck aspect ratio (13.333" × 7.5" / 960 × 540 pt for the default
  16:9 deck).
- Pixel fidelity with the editor: reuse `drawSlide()` so shapes,
  images (crop/recolor), tables, connectors, groups, effects, theme
  colors, and background images all render exactly as on screen.
- Wait for **all images and fonts** to finish loading before
  snapshotting each slide (the core technical work — see below).
- High-DPI output (configurable scale, default 2× → 3840 × 2160 source
  bitmap) so text/shape edges stay crisp.
- Wire an "Export → PDF" entry into the Slides toolbar, mirroring the
  docs export dropdown UX.
- Reuse docs frontend export helpers (`downloadBlob`, `safeFilename`).
- Dynamic-import the export module so it does not bloat the initial
  Slides bundle (same pattern as docs `pdf-actions.ts`).

### Non-Goals (P0)

- **Selectable / vector text** — deferred to P1 (text-overlay hybrid).
- Speaker-notes pages, handout layouts (N-up), slide-range selection.
- Animations / transitions in the PDF (export the final rendered
  state of each slide; ignore `animations`/`transition`).
- CLI / Node-side export — P0 is browser-only (needs DOM `Image`,
  `document.fonts`, `OffscreenCanvas`). CLI export is a later phase
  (would require `node-canvas`).
- Hyperlinks, bookmarks, PDF metadata beyond title (P1+).

## Proposal Details

### Architecture

```
exportSlidesPdf(doc, opts)                      packages/slides/src/export/pdf.ts
  ├─ pageWidth = 960 pt (13.333"); pageHeight = deckSlideHeight(meta)/SLIDE_WIDTH × 960
  ├─ pdf = await PDFDocument.create()
  ├─ await document.fonts.ready                 // defensive only; caller pre-loads families
  └─ for each slide:
       ├─ canvas = makeCanvas(W*scale, H*scale)
       ├─ await renderSlideToCanvas(canvas, slide, doc, scale)   // render-and-wait loop
       ├─ blob/bytes = canvas → PNG (or JPEG q≈0.92)
       ├─ img = await pdf.embedPng(bytes)
       ├─ page = pdf.addPage([pageWidth, pageHeight])
       └─ page.drawImage(img, { x:0, y:0, width:pageWidth, height:pageHeight })
  └─ return await pdf.save()  // Uint8Array → Blob

exportSlidesPdfAndDownload(doc, title, onProgress?)   packages/frontend/src/app/slides/pdf-actions.ts
  ├─ families = collectFontFamilies(doc); ensureFontLink + await document.fonts.load  // caller-owned font prep
  ├─ bytes = await exportSlidesPdf(doc, { imageFetcher: docsImageFetcher, title, onProgress })
  ├─ blob = new Blob([bytes], { type: 'application/pdf' })
  └─ downloadBlob(blob, safeFilename(title, 'pdf'))   // reuse docs export-utils
```

`pdf-lib` is dynamic-imported *inside* `exportSlidesPdf` (not at the
frontend call site), so it stays out of the editor bundle until an
export actually runs; `exportSlidesPdf` / `collectFontFamilies` are
re-exported from the main `@wafflebase/slides` entry.

### The core problem: render-and-wait

`drawSlide()` is **synchronous but triggers async loads** via an
`onAssetLoad` callback. The image cache
(`view/canvas/image-cache.ts`) returns `null` for a not-yet-loaded
src and fires the callback later; failed images paint a placeholder
synchronously. There is **no built-in "render once everything is
loaded"** — every consumer (editor, thumbnails) just re-renders on
each callback. The exporter must close this gap deterministically.

`renderSlideToCanvas` (new helper):

1. **Preload images.** Walk the slide's elements (recursing into
   groups) to collect every image `src` (image elements + background
   image + any image-bearing fills). Kick off
   `getOrLoadImage(src, cb)` for each and `await` a promise that
   resolves when the cache reports each src as loaded **or** failed
   (`isImageFailed`). This makes "all images settled" explicit rather
   than relying on render-callback bookkeeping.
2. **Render once.** After assets settle, call
   `drawSlide(ctx, slide, doc, { hostWidth: W, hostHeight: H, dpr: scale })`
   exactly once with a no-op `onAssetLoad`. All images are now cached
   → `drawImage` runs; all fonts are loaded → text uses correct
   glyphs.
3. **Failsafe.** Bound the wait with a timeout (e.g. 10 s/slide) so a
   single broken asset URL can't hang the whole export; on timeout,
   render with whatever is available (placeholders for failures).

The clone also **strips `placeholderRef`** from every element. Empty
placeholders paint an editor-only "Click to add title" ghost hint via
the same `drawSlide` path; without stripping, that hint would leak into
the exported PDF. `placeholderRef` is the sole render-path consumer of
the hint, and committed placeholder text bakes its own typography into
the blocks, so dropping the ref only suppresses the hint.

Fonts are handled once up-front, not per slide — and font preparation is
**caller-owned**, because the slides package can't reach the app's font
CSS. The slides package exposes `collectFontFamilies(doc)`, which scans
all slide text blocks for `fontFamily` (incl. list-marker `buFont`) plus
each theme's heading/body fonts. The frontend wrapper
`exportSlidesPdfAndDownload` calls it, injects a Google-Fonts `<link>`
for any family not yet linked via `ensureFontLink`, then
`await Promise.all(families.map(f => document.fonts.load(\`16px "${f}"\`)))`
(mirroring docs' `ensureCanvasFontsLoaded`) — all **before** invoking
`exportSlidesPdf`. `exportSlidesPdf` itself only defensively awaits
`document.fonts.ready`; it cannot initiate lazy font CSS, so a direct
caller of the public API must perform this preparation itself.

### Canvas + DPI

- Source bitmap: `OffscreenCanvas(SLIDE_WIDTH * scale, SLIDE_HEIGHT *
  scale)` where `SLIDE_WIDTH=1920`, `SLIDE_HEIGHT=1080`, default
  `scale = 2`. Fall back to a detached `<canvas>` where
  `OffscreenCanvas` is unavailable (already shimmed in tests via
  `test-canvas-env.ts`).
- `drawSlide` options pass `dpr: scale`; it applies
  `setTransform(scale,0,0,scale,0,0)` internally (same as
  `presenter.ts` / `layout-preview.ts`), so logical coords stay
  1920×1080 while the bitmap is high-res.
- Page width is always 960 pt (13.333"); page height is
  `deckSlideHeight(doc.meta) / SLIDE_WIDTH × 960` pt (540 pt for the
  default 16:9 deck, 720 pt for 4:3). `drawImage` scales the bitmap to
  fill, so `scale` only affects sharpness/size, never geometry.

### Encoding choice

PNG by default (lossless — crisp text/shape edges). Offer JPEG
(quality ≈ 0.92) as an option for photo-heavy decks where PNG balloons
file size. `pdf-lib` supports both via `embedPng` / `embedJpg`.

### Module / export surface

- `packages/slides/src/export/pdf.ts` →
  `exportSlidesPdf(doc: SlidesDocument, opts?: ExportSlidesPdfOptions):
  Promise<Uint8Array>`, where `ExportSlidesPdfOptions` carries `scale?`,
  `format?: 'png' | 'jpeg'`, `quality?`, `imageFetcher?`,
  `assetTimeoutMs?`, `title?`, and `onProgress?`. `exportSlidesPdf`,
  `collectFontFamilies`, and the `ExportSlidesPdfOptions` /
  `SlidesImageFetcher` types are re-exported from the main
  `@wafflebase/slides` entry (no separate subpath); the module is
  browser-only (DOM `Image` / `OffscreenCanvas` / `document.fonts`).
- `pdf-lib` is listed in `@wafflebase/slides` `package.json` and is
  dynamic-imported inside `exportSlidesPdf`.
- Reuse `downloadBlob` / `safeFilename` from
  `frontend/src/app/docs/export-utils.ts` (consider promoting them to
  a shared frontend util; not required for P0).

### UI wiring

The export control ships as a header **Export** menu
(`packages/frontend/src/app/slides/slides-export-button.tsx`) offering
PDF (`.pdf`) and PPTX (`.pptx`) items. The PDF item calls
`exportSlidesPdfAndDownload(store.doc, documentTitle, onProgress)`. It
shows a busy/spinner state while rendering (large decks take a few
seconds), reports progress via the shared docs export toast
(`updateExportToast`), and surfaces failures.

### Testing

- Unit: `renderSlideToCanvas` resolves only after a stub image cache
  reports all srcs loaded; times out gracefully on a failing src
  (reuse `test-canvas-env.ts` + the `flushMicrotasks` pattern from
  `thumbnail.test.ts`).
- Unit: font scanner enumerates the expected families from a deck.
- Integration: `exportSlidesPdf` on a small fixture deck returns a
  valid PDF (`PDFDocument.load` round-trips), page count == slide
  count, page width == 960 pt with height matching the deck aspect
  (540 pt for the default 16:9 fixture).

## Risks and Mitigation

| Risk | Mitigation |
| ---- | ---------- |
| Text not selectable in PDF (raster) | Documented non-goal; P1 hybrid overlays docs `PdfPainter` text on the raster background. Module shaped so the per-slide page can gain a text pass without restructuring. |
| File size on image-heavy decks | Default `scale=2` (not 3); offer JPEG encoding option; one image per page (not per element). |
| A broken/slow image URL hangs export | Per-slide timeout failsafe; render with placeholder (same as editor's `isImageFailed` path). |
| Fonts render in fallback if not loaded before snapshot | Up-front `ensureFontLink` + `document.fonts.load` for every used family/weight; await before any slide render. |
| `OffscreenCanvas` unavailable in some browsers/tests | Fall back to detached `<canvas>`; tests use the existing `FakeOffscreenCanvas` shim. |
| Cross-origin images taint the canvas → `toBlob` throws | The exporter fetches each image's bytes (with credentials, via the injected `imageFetcher` — the frontend passes `docsImageFetcher`) into a same-origin object URL, clones each slide with the rewritten srcs, and renders the clone; images whose bytes cannot be fetched fall back to a blank 1×1 PNG. The editor's slides and shared image cache are never mutated. |
| Animations/transitions not represented | Non-goal for P0; export the resting rendered state. |
```
