# DOCX import: image upload 400 + images not rendering in table cells

Date: 2026-04-12

## Problem

Two distinct bugs surfaced while importing `~/Downloads/form2.docx` on the
local dev server:

1. **HTTP 400 from `/images` on every embedded image.**
   ```
   Unsupported file type: application/octet-stream
   ```
2. **Images imported via the pending-import path were missing from the
   editor.** Text flowed as if the images were there, but the picture slots
   were blank.

Both reproduce with any `.docx` that contains inline images inside a table —
`form2.docx` has three PNGs nested deep in a single cell of its main
"신청 프로젝트 정보" table.

## Root causes

### 1. JSZip blob has no MIME type

`DocxImporter.uploadImages()` extracted image bytes via
`jszip.file(path).async('blob')`. JSZip produces a `Blob` with `type === ''`,
so when the frontend `docxImageUploader` posts it via `FormData`, the
multipart `Content-Type` defaults to `application/octet-stream`.
`ImageService.upload()` only accepts `image/png|jpeg|gif|webp` and rejects
the upload with `BadRequestException` → HTTP 400.

Confirmed end-to-end with a direct `curl` against `/images` using a local
session cookie — `type=application/octet-stream` returns 400, `type=image/png`
returns 201.

### 2. Table renderer had no image branch

`renderTableContent()` in `packages/docs/src/view/table-renderer.ts` walked
every run in a cell line and unconditionally called
`ctx.fillText(run.text, …)`. Image inlines carry `run.text === '\uFFFC'`
(Object Replacement Character) plus `run.imageHeight`, so the picture was
never drawn — only the ORC placeholder was painted. The body paragraph
renderer in `doc-canvas.ts:648` already handled this via `drawImage`; the
table renderer was simply missing the mirror branch.

`getOrLoadImage` / `imageCache` / `pendingImageCallbacks` lived as
module-locals inside `doc-canvas.ts`, so the table renderer had no way to
share the cache even if it had tried.

## Fix

### Image upload

`packages/docs/src/import/docx-importer.ts`
- Add an `EXT_TO_IMAGE_MIME` map (`png → image/png`, `jpg|jpeg → image/jpeg`,
  `gif → image/gif`, `webp → image/webp`).
- In `uploadImages()`, wrap the raw JSZip blob with
  `new Blob([raw], { type: mime })` when the extension is recognised; fall
  through to the raw blob otherwise so unknown parts keep surfacing the
  backend error instead of silently sending a bad MIME.

### Image rendering in table cells

`packages/docs/src/view/image-cache.ts` **(new)**
- Extracted shared `getOrLoadImage`, `imageCache`, `pendingImageCallbacks`
  from `doc-canvas.ts` so both renderers share a single load cache.

`packages/docs/src/view/doc-canvas.ts`
- Import `getOrLoadImage` from the shared module (remove the private copy).
- Pass `this.requestRender ?? undefined` into `renderTableContent`.

`packages/docs/src/view/table-renderer.ts`
- Accept a `requestRender?: () => void` parameter on `renderTableContent`.
- Add an image branch at the top of the per-run loop: bottom-align the
  (possibly scaled) image to the line and call `ctx.drawImage`, mirroring
  the body path in `doc-canvas.ts`.

## Tests

- `packages/docs/test/import/docx-importer.test.ts` — asserts the uploader
  receives a `Blob` with `type === 'image/png'` and the correct filename.
- `packages/docs/test/view/table-renderer.test.ts` — asserts an image run
  is never drawn via `fillText(ORC)` and that `drawImage` is never called
  while the image is still loading (entry point for the cache).

## Verification

- [x] `pnpm --filter @wafflebase/docs test` (491 → 493, two new cases)
- [x] `pnpm verify:fast` → PASS
- [x] Manual end-to-end against `form2.docx` on local dev server:
  - 3 PNGs upload with `type="image/png"` → HTTP 201
  - Yorkie architecture diagram, CodePair screenshot, and Wafflebase demo
    all render in their table cell at the correct size/position.
