# Slides PDF Export (P0 — raster) — TODO

Design: `docs/design/slides/slides-pdf-export.md`
Branch: `slides-pdf-export`
PR: #395

## Relation to prior tracked items

Slides PDF export was already planned before this task; this delivers it:

- **Fulfils** [`20260505-slides-package-mvp-todo.md`](./20260505-slides-package-mvp-todo.md)
  **P5.6** (`export/pdf.ts`). The MVP plan assumed delegating
  font/embedding to docs' vector painter; we chose raster instead
  (docs' `PdfPainter` can't paint slide shapes/connectors/effects).
- **Unblocks** [`20260608-slides-tables-todo.md`](./20260608-slides-tables-todo.md)
  **P6** — table cells now render in the PDF via the shared
  `drawSlide()` pipeline; only the visual-diff verification remains.
- **Still open (not in this task):** MVP **P5.7/P5.8** — CLI
  `slides export-pdf` + backend roundtrip e2e (needs `node-canvas`); and
  [`20260616-slides-fonts-todo.md`](./20260616-slides-fonts-todo.md)
  **P3** — generalising `pdf-fonts.ts` subsetting + license notices,
  which matters mainly for the vector-text **P1** follow-up (raster P0
  embeds via `document.fonts`, not pdf-fonts subsetting).

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

Implemented P0 end-to-end:
- `packages/slides/src/export/pdf.ts` — `exportSlidesPdf` + `collectFontFamilies`.
- `evictImageSrcs` in image-cache; re-exports in `index.ts`; `pdf-lib` dep.
- Frontend `pdf-actions.ts` + `slides-export-button.tsx`, wired into both
  header sites in `slides-detail.tsx`.
- Tests: `test/export/pdf.test.ts` (7) + `pdf-placeholder.test.ts` (1).
- `pnpm verify:fast` green (slides 2072 tests pass).

Code review (high effort, 7 finder angles → verify) findings addressed:
1. **[bug] Placeholder ghost hints leaked into the PDF** — empty
   placeholders paint "Click to add title" via the shared `drawSlide`.
   Fixed by stripping `placeholderRef` on the export clone
   (`prepareExportSlide`). Added a deterministic test. *(Note: the same
   hint renders in presentation mode — pre-existing, out of scope here.)*
2. **[perf] Sequential image fetch** — `resolveDeckImages` now fetches
   all images concurrently via `Promise.all`.
3. **[correctness] List-marker fonts** — `collectFontFamilies` now also
   collects `block.marker.fontFamily` (PPTX `<a:buFont>`).

Considered & dropped: PNG-ignores-quality (spec no-op, harmless),
`assetTimeoutMs=0` hang (opt-in only; default 15s), deep-clone overhead
(acceptable; clone is the safe taint-isolation seam).

### Known limitations / follow-ups
- Raster only — PDF text not selectable (P1: vector text overlay).
- Desktop header only; mobile export deferred.
- Animations/transitions render at resting state.
- CLI/Node export deferred (needs `node-canvas`).
```
