# Slides PDF Export (P0 — raster) — TODO

Design: `docs/design/slides/slides-pdf-export.md`
Branch: `slides-pdf-export`

## Goal

Ship P0 raster PDF export for Slides: one slide per page, rendered via
the existing `drawSlide()` pipeline to a high-DPI offscreen canvas and
embedded into a pdf-lib document at 13.333" × 7.5" (16:9). Wire an
"Export → PDF" entry into the Slides toolbar.

## Key constraints discovered

- **Canvas taint**: prod serves images from a different origin
  (`api.wafflebase.io`), and the editor loads them via plain
  `img.src` (no CORS). Drawing them then calling `toBlob` taints the
  canvas → throws. Fix: fetch each image with credentials → object URL
  (taint-free), deep-clone each slide with rewritten srcs, render the
  clone. Evict the temp URLs from the shared image cache + revoke after.
- **Master background images** must be resolved into the cloned slide
  so `drawSlide`'s `pickBackgroundImage` never reaches the original
  cross-origin master src.
- **strip-types**: `export/pdf.ts` flows through the public surface, so
  no enums / parameter-properties / namespaces (plain functions only).
- **Fonts**: lazy Google Fonts may not be loaded for un-viewed slides.
  Caller (frontend) must `ensureFontLink` + `document.fonts.load` every
  used family before export; core awaits `document.fonts.ready`.
- **pdf-lib** is a docs dep but not a slides dep → add it.

## Tasks

- [ ] Add `evictImageSrcs(srcs)` to `view/canvas/image-cache.ts`.
- [ ] `packages/slides/src/export/pdf.ts`:
  - [ ] `collectFontFamilies(doc)` — theme heading/body + all inline `fontFamily`.
  - [ ] image src collection (image elements recursing groups + effective bg per slide).
  - [ ] `resolveDeckImages(doc, fetcher)` → `{ map, temp }` (object URLs; data/blob passthrough; failed→placeholder).
  - [ ] `cloneSlideWithCleanImages(slide, doc, map)` (structuredClone + rewrite + master-bg resolve).
  - [ ] `renderSlideToCanvas` (preload images, single `drawSlide`).
  - [ ] `canvasToBytes` (OffscreenCanvas/HTMLCanvas, png/jpeg).
  - [ ] `exportSlidesPdf(doc, opts)` — dynamic-import pdf-lib, page per slide, 960×540 pt.
- [ ] Re-export `exportSlidesPdf` + `collectFontFamilies` + types from `src/index.ts`.
- [ ] Add `pdf-lib` to `packages/slides/package.json`.
- [ ] Frontend `packages/frontend/src/app/slides/pdf-actions.ts`:
  - [ ] `exportSlidesPdfAndDownload(doc, title)` — ensure fonts, fetch images, download.
  - [ ] reuse `downloadBlob` / `safeFilename` from docs `export-utils`.
- [ ] Wire "Export → PDF" into the Slides toolbar right-side globals.
- [ ] Tests: font scan, render-and-wait, PDF round-trip (page count/size).
- [ ] `pnpm verify:fast` green.
- [ ] Code review pass; address blocking findings.

## Review

(to fill in after implementation)
```
