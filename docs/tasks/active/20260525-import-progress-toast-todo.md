---
title: Import progress toast (PPTX + DOCX)
date: 2026-05-25
status: in-progress
---

# Import progress toast (PPTX + DOCX)

Importing a `.pptx` or `.docx` from the document list parses the archive
client-side and **uploads each embedded image serially** to `/images`
before the document is created. For image-heavy files this is the slow
part of the import, yet the UI shows no feedback during it — only the
Import buttons are disabled (`importing` flag). The user is left staring
at a frozen-looking screen until the final success/error toast appears.

This task adds a live progress toast: a `toast.loading` that updates
`Uploading images X / N` during the upload phase, then morphs in place
into the existing success/error toast.

## Decisions (from brainstorming)

- **Granularity** — determinate count `X / N` (not a bare spinner or
  phase labels).
- **Scope** — both PPTX/slides and DOCX (both share the same silent-gap
  pattern).
- **Denominator (N)** — pragmatic media-file count (`ppt/media/*` /
  `word/media/*` filtered to image extensions), computed once from the
  already-unzipped archive. Correct for virtually all real files; rare
  1–2 drift is clamped in the display and overridden by the final toast.
  Chosen over an exact count, which would require a pre-count pass or a
  collect-then-upload refactor inside both importers (notably invasive
  in the PPTX parser).

## Design

### 1. Slides package — `importPptx` gains `onProgress`

- Add `onProgress?: (done: number, total: number) => void` to
  `ImportPptxOptions` (`packages/slides/src/import/pptx/index.ts`).
- After `unzipPptx`, compute `total` from
  `archive.list('ppt/media/')` filtered by image extension. Emit
  `onProgress(0, total)` once up front.
- `parseBlipFill` (`packages/slides/src/import/pptx/image.ts:79`) is the
  **single** `uploadImage` call site — all pics, backgrounds, master,
  layout, and slide images funnel through it. Thread a shared mutable
  progress counter + the callback through `ImageParseContext`; after
  **every** upload attempt (both the success path and the soft-fail
  `catch`) increment the counter and emit `onProgress(done, total)` so
  the bar always advances, even for skipped images.

### 2. Docs package — `DocxImporter.import` gains `onProgress`

- Add an optional **3rd positional param**:
  `import(buffer, imageUploader?, onProgress?)`
  (`packages/docs/src/import/docx-importer.ts`). Positional keeps every
  existing caller (CLI, tests, frontend) working untouched; an options
  object would churn more call sites for no benefit.
- Compute `total` from JSZip entries under `word/media/` with an image
  extension. Emit `onProgress(0, total)` once.
- Thread the counter + callback into `uploadImages`
  (`docx-importer.ts:595`, the single `uploader` call site) and
  `parseHeaderFooter`; increment after each `uploader` call.

### 3. Frontend actions — enrich progress with the filename

- `pickAndImportPptx(onProgress?)` / `pickAndImportDocx(onProgress?)`
  where the **handler-facing** callback is
  `(p: { done: number; total: number; fileName: string }) => void`.
  The action layer already knows `file.name`, so it forwards the
  importer's `(done, total)` enriched with the filename — letting the
  progress toast show the real title (matching the approved mockup).
  The package-level `onProgress` stays `(done, total)`; the package has
  no notion of the filename.

### 4. Frontend handlers — drive the toast (`document-list.tsx`)

- **Lazy toast**: create the `toast.loading(...)` on the **first**
  `onProgress` tick. That tick fires only after a file is chosen (after
  `unzip`), so cancelling the file picker shows no toast. Hold the id in
  a local `let toastId`; subsequent ticks update via `{ id: toastId }`.
- Label `Importing "<title>"…`; description
  `Uploading images <min(done, total)> / <total>` shown only when
  `total > 0` (image-less files just show the spinner line).
- On success/error, reuse the same `{ id: toastId }` so the loading
  toast morphs in place, preserving the existing summary/error text.
  Keep the existing `importing` button-disable behavior; the toast is
  purely additive.

### Edge cases

- **Picker cancelled** — no `onProgress` tick fires → no toast, nothing
  to dismiss.
- **`done > total`** (a reused image, PPTX uploads per reference) —
  clamp the display with `Math.min(done, total)`.
- **`done < total` at end** (unreferenced media in the archive) — the
  final success toast overrides the stalled counter.
- **DOCX upload error mid-way** — propagates and aborts as it does today
  → becomes the error toast in place via `{ id }`. (PPTX soft-fails per
  image, so it keeps going.)

### Files touched

- `packages/slides/src/import/pptx/index.ts`
- `packages/slides/src/import/pptx/image.ts`
- `packages/docs/src/import/docx-importer.ts`
- `packages/frontend/src/app/slides/pptx-actions.ts`
- `packages/frontend/src/app/docs/docx-actions.ts`
- `packages/frontend/src/app/documents/document-list.tsx`
- slides + docs import test suites

## Testing

- **Slides** — unit test that `importPptx` calls `onProgress` first with
  `(0, total)`, that `total` equals the image-media count of an existing
  image-bearing fixture, and that `done` rises monotonically to `total`.
- **Docs** — equivalent unit test for `DocxImporter.import` `onProgress`
  on an existing image-bearing `.docx` fixture.
- **Frontend** — toast/handler wiring verified by manual smoke in
  `pnpm dev` (the existing import handlers carry no unit tests).

## Plan

_(filled in by the implementation-plan step)_

## Risk notes

_(filled in during/after implementation)_

## Review

_(filled in after implementation)_
