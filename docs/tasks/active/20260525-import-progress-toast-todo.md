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
- **Wrap the injected uploader at the single injection point.**
  `importPptx` passes `opts.uploadImage` down into both
  `loadMasterAndLayouts` and every `parseSlide` — all pics,
  backgrounds, master, layout, and slide images ultimately call it. So
  rather than threading a counter through every `ImageParseContext`,
  wrap `opts.uploadImage` once in `index.ts` and pass the wrapper down.
  The wrapper increments `done` in a `finally` (so a soft-failed upload
  still advances the bar) and emits `onProgress(done, total)`. No
  changes to `image.ts`/`slide.ts`/`shape.ts` parse contexts — only a
  one-word `export` of the existing `EXT_TO_MIME` map for the count
  filter.

### 2. Docs package — `DocxImporter.import` gains `onProgress`

- Add an optional **3rd positional param**:
  `import(buffer, imageUploader?, onProgress?)`
  (`packages/docs/src/import/docx-importer.ts`). Positional keeps every
  existing caller (CLI, tests, frontend) working untouched; an options
  object would churn more call sites for no benefit.
- Compute `total` from JSZip entries under `word/media/` with an image
  extension. Emit `onProgress(0, total)` once.
- **Same wrapper pattern**: `import` is the single place that injects
  `imageUploader` into `uploadImages` (document part) and
  `parseHeaderFooter` (header/footer parts). Wrap `imageUploader` once
  at the top of `import` and pass the wrapper to both; increment +
  emit in a `finally`. No changes to `uploadImages` internals.

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

- `packages/slides/src/import/pptx/index.ts` — `onProgress` option,
  media count, uploader wrapper
- `packages/slides/src/import/pptx/image.ts` — `export` `EXT_TO_MIME`
- `packages/slides/test/import/pptx/__fixtures__/build-minimal-pptx.ts`
  — optional `imageCount` to emit a deck with images
- `packages/slides/test/import/pptx/index.test.ts` — progress tests
- `packages/docs/src/import/docx-importer.ts` — `onProgress` param,
  media count, uploader wrapper
- `packages/docs/test/import/docx-importer.test.ts` — progress tests
- `packages/frontend/src/app/slides/pptx-actions.ts` — `onProgress`
  param forwarding `fileName`
- `packages/frontend/src/app/docs/docx-actions.ts` — `onProgress`
  param forwarding `fileName`
- `packages/frontend/src/app/documents/document-list.tsx` — lazy
  progress toast in both import handlers

## Testing

- **Slides** — unit test that `importPptx` calls `onProgress` first with
  `(0, total)`, that `total` equals the image-media count of an existing
  image-bearing fixture, and that `done` rises monotonically to `total`.
- **Docs** — equivalent unit test for `DocxImporter.import` `onProgress`
  on an existing image-bearing `.docx` fixture.
- **Frontend** — toast/handler wiring verified by manual smoke in
  `pnpm dev` (the existing import handlers carry no unit tests).

## Plan

> **For agentic workers:** implement task-by-task; each step is one small
> action. Steps use checkbox (`- [ ]`) syntax. TDD where the surface is
> unit-testable (Tasks 1–2); Tasks 3–4 are frontend wiring verified by
> typecheck + manual smoke.

**Goal:** Show a live `toast.loading` "Uploading images X / N" during
PPTX/DOCX import, morphing in place into the existing success/error toast.

**Architecture:** Each importer wraps its injected upload callback at the
single injection point to count progress (no parse-context threading).
`total` = image-media-file count. Frontend actions forward the filename;
the document-list handlers drive a lazily-created toast.

---

### Task 1: Slides — `importPptx` reports upload progress

**Files:**
- Modify: `packages/slides/src/import/pptx/image.ts` (export `EXT_TO_MIME`)
- Modify: `packages/slides/src/import/pptx/index.ts`
- Modify: `packages/slides/test/import/pptx/__fixtures__/build-minimal-pptx.ts`
- Test: `packages/slides/test/import/pptx/index.test.ts`

- [ ] **Step 1: Make the fixture builder able to emit images**

In `build-minimal-pptx.ts`, change the signature and the two slide-part
writes, add a media loop, and replace the `SLIDE`/`SLIDE_RELS` constants
with builder functions + a PNG constant. Replace lines 11–27:

```ts
export async function buildMinimalPptx(
  opts: { imageCount?: number } = {},
): Promise<ArrayBuffer> {
  const imageCount = opts.imageCount ?? 0;
  const zip = new JSZip();

  zip.file('[Content_Types].xml', CONTENT_TYPES);
  zip.file('_rels/.rels', ROOT_RELS);
  zip.file('ppt/presentation.xml', PRESENTATION);
  zip.file('ppt/_rels/presentation.xml.rels', PRESENTATION_RELS);
  zip.file('ppt/theme/theme1.xml', THEME);
  zip.file('ppt/slideMasters/slideMaster1.xml', SLIDE_MASTER);
  zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', SLIDE_MASTER_RELS);
  zip.file('ppt/slideLayouts/slideLayout1.xml', SLIDE_LAYOUT);
  zip.file('ppt/slideLayouts/_rels/slideLayout1.xml.rels', SLIDE_LAYOUT_RELS);
  zip.file('ppt/slides/slide1.xml', buildSlide(imageCount));
  zip.file('ppt/slides/_rels/slide1.xml.rels', buildSlideRels(imageCount));
  for (let i = 1; i <= imageCount; i++) {
    zip.file(`ppt/media/image${i}.png`, PNG_1X1);
  }

  return zip.generateAsync({ type: 'arraybuffer' });
}

/** Minimal 1x1 transparent PNG — content is irrelevant to the importer. */
const PNG_1X1 = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

function buildSlide(imageCount: number): string {
  const pics = Array.from({ length: imageCount }, (_, k) => {
    const i = k + 1;
    return `<p:pic>
      <p:nvPicPr><p:cNvPr id="${i + 10}" name="Picture ${i}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
      <p:blipFill><a:blip r:embed="rId${i + 1}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
      <p:spPr><a:xfrm><a:off x="914400" y="457200"/><a:ext cx="1828800" cy="914400"/></a:xfrm></p:spPr>
    </p:pic>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      ${pics}
    </p:spTree>
  </p:cSld>
</p:sld>`;
}

function buildSlideRels(imageCount: number): string {
  const imageRels = Array.from({ length: imageCount }, (_, k) => {
    const i = k + 1;
    return `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${i}.png"/>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  ${imageRels}
</Relationships>`;
}
```

Then delete the now-unused `SLIDE` and `SLIDE_RELS` `const` declarations
(lines 118–131 of the original file). Leave all other constants intact.

- [ ] **Step 2: Write the failing progress tests**

Append to `packages/slides/test/import/pptx/index.test.ts` inside the
`describe('importPptx', ...)` block:

```ts
  it('reports image upload progress via onProgress', async () => {
    const buffer = await buildMinimalPptx({ imageCount: 2 });
    const calls: Array<[number, number]> = [];
    await importPptx(buffer, {
      uploadImage: async () => 'https://cdn/img.png',
      onProgress: (done, total) => calls.push([done, total]),
    });
    // First tick is the up-front (0, total); then one per upload.
    expect(calls[0]).toEqual([0, 2]);
    expect(calls).toHaveLength(3);
    expect(calls.every(([, total]) => total === 2)).toBe(true);
    expect(calls.map(([done]) => done).sort()).toEqual([0, 1, 2]);
  });

  it('reports (0, 0) for a deck with no images', async () => {
    const buffer = await buildMinimalPptx();
    const calls: Array<[number, number]> = [];
    await importPptx(buffer, { onProgress: (d, t) => calls.push([d, t]) });
    expect(calls).toEqual([[0, 0]]);
  });
```

- [ ] **Step 3: Run the tests — expect failure**

Run: `pnpm --filter @wafflebase/slides test -- index.test.ts`
Expected: the two new tests FAIL (`onProgress` not called / not a known
option), existing tests still pass.

- [ ] **Step 4: Export `EXT_TO_MIME`**

In `packages/slides/src/import/pptx/image.ts:12`, change
`const EXT_TO_MIME` to `export const EXT_TO_MIME`.

- [ ] **Step 5: Implement `onProgress` in `index.ts`**

Add the import (extend the existing image import on line 17):

```ts
import { EXT_TO_MIME } from './image';
import type { ImageParseContext } from './image';
```

Add to `ImportPptxOptions` (after the `uploadImage?` field, ~line 29):

```ts
  /**
   * Called once with `(0, total)` right after the archive is unzipped,
   * then once after every image upload attempt with the running
   * `(done, total)`. `total` is the count of image files under
   * `ppt/media/` — a pragmatic denominator that matches the upload
   * count for virtually all decks. Drives the import progress toast.
   */
  onProgress?: (done: number, total: number) => void;
```

Right after `const report = new ImportReport();` (line 58), insert:

```ts
  // Wrap the host uploader so the importer can report progress without
  // threading a counter through every parse context. `total` is the
  // image-media count (a pragmatic denominator); `done` bumps in a
  // `finally` so a soft-failed upload still advances the bar.
  let upload = opts.uploadImage;
  if (opts.onProgress) {
    const emit = opts.onProgress;
    const total = archive
      .list('ppt/media/')
      .filter((p) => (p.split('.').pop()?.toLowerCase() ?? '') in EXT_TO_MIME)
      .length;
    emit(0, total);
    if (opts.uploadImage) {
      const inner = opts.uploadImage;
      let done = 0;
      upload = async (bytes, mime) => {
        try {
          return await inner(bytes, mime);
        } finally {
          done += 1;
          emit(done, total);
        }
      };
    }
  }
```

Then route uploads through the wrapper: in the `loadMasterAndLayouts`
call change `opts.uploadImage,` (line ~87) to `upload,`; in the
`parseSlide({ ... })` call change `uploadImage: opts.uploadImage,`
(line ~118) to `uploadImage: upload,`.

- [ ] **Step 6: Run the tests — expect pass**

Run: `pnpm --filter @wafflebase/slides test -- index.test.ts`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/slides/src/import/pptx/index.ts \
        packages/slides/src/import/pptx/image.ts \
        packages/slides/test/import/pptx/__fixtures__/build-minimal-pptx.ts \
        packages/slides/test/import/pptx/index.test.ts
git commit -m "Report PPTX image upload progress via importPptx onProgress"
```

---

### Task 2: Docs — `DocxImporter.import` reports upload progress

**Files:**
- Modify: `packages/docs/src/import/docx-importer.ts`
- Test: `packages/docs/test/import/docx-importer.test.ts`

- [ ] **Step 1: Write the failing progress tests**

Append inside `describe('DocxImporter', ...)` in
`packages/docs/test/import/docx-importer.test.ts`:

```ts
  it('reports image upload progress via onProgress', async () => {
    const drawingXml = `
      <w:r>
        <w:drawing>
          <wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
            <wp:extent cx="914400" cy="457200"/>
            <wp:docPr id="1" name="Picture 1"/>
            <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
              <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
                <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
                  <pic:blipFill>
                    <a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId5"/>
                  </pic:blipFill>
                </pic:pic>
              </a:graphicData>
            </a:graphic>
          </wp:inline>
        </w:drawing>
      </w:r>`;
    const relsXml = `<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
      </Relationships>`;
    const pngBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
      0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00,
      0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
      0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);
    const buffer = await createMinimalDocx(`<w:p>${drawingXml}</w:p>`, {
      relsXml,
      extraFiles: { 'word/media/image1.png': pngBytes },
    });
    const calls: Array<[number, number]> = [];
    await DocxImporter.import(
      buffer,
      async () => 'https://example.com/image1.png',
      (done, total) => calls.push([done, total]),
    );
    expect(calls).toEqual([[0, 1], [1, 1]]);
  });

  it('reports (0, 0) for a document with no images', async () => {
    const buffer = await createMinimalDocx(
      `<w:p><w:r><w:t>Hi</w:t></w:r></w:p>`,
    );
    const calls: Array<[number, number]> = [];
    await DocxImporter.import(buffer, undefined, (d, t) => calls.push([d, t]));
    expect(calls).toEqual([[0, 0]]);
  });
```

- [ ] **Step 2: Run the tests — expect failure**

Run: `pnpm --filter @wafflebase/docs test -- docx-importer.test.ts`
Expected: the two new tests FAIL; existing tests still pass.

- [ ] **Step 3: Implement `onProgress` in `DocxImporter.import`**

Change the signature and insert the wrapper at the top of `import`
(`packages/docs/src/import/docx-importer.ts`, ~line 71). The method
currently starts:

```ts
  static async import(
    buffer: ArrayBuffer,
    imageUploader?: ImageUploader,
  ): Promise<Document> {
    const zip = await JSZip.loadAsync(buffer);
```

Replace with:

```ts
  static async import(
    buffer: ArrayBuffer,
    imageUploader?: ImageUploader,
    onProgress?: (done: number, total: number) => void,
  ): Promise<Document> {
    const zip = await JSZip.loadAsync(buffer);

    // Wrap the uploader once so progress is reported without threading a
    // counter through uploadImages/parseHeaderFooter. `total` is the
    // image-media count; `done` bumps in a `finally`.
    let uploader = imageUploader;
    if (onProgress) {
      const emit = onProgress;
      let total = 0;
      zip.forEach((path, file) => {
        if (file.dir || !path.startsWith('word/media/')) return;
        const ext = (path.split('.').pop() || '').toLowerCase();
        if (EXT_TO_IMAGE_MIME[ext]) total += 1;
      });
      emit(0, total);
      if (imageUploader) {
        const inner = imageUploader;
        let done = 0;
        uploader = async (data, filename) => {
          try {
            return await inner(data, filename);
          } finally {
            done += 1;
            emit(done, total);
          }
        };
      }
    }
```

Then replace the remaining `imageUploader` references inside `import`
with `uploader`:
- the document-part upload guard + call (~lines 91–93):
  `if (uploader) { await DocxImporter.uploadImages(zip, rels, 'word/', uploader, imageUrls); }`
- the two `parseHeaderFooter(zip, 'header'|'footer', target, uploader)`
  calls (~lines 122–127).

Leave `uploadImages` and `parseHeaderFooter` internals unchanged.

- [ ] **Step 4: Run the tests — expect pass**

Run: `pnpm --filter @wafflebase/docs test -- docx-importer.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/docs/src/import/docx-importer.ts \
        packages/docs/test/import/docx-importer.test.ts
git commit -m "Report DOCX image upload progress via DocxImporter onProgress"
```

---

### Task 3: Frontend actions forward progress + filename

**Files:**
- Modify: `packages/frontend/src/app/slides/pptx-actions.ts`
- Modify: `packages/frontend/src/app/docs/docx-actions.ts`

- [ ] **Step 1: `pickAndImportPptx` accepts `onProgress`**

Replace the `pickAndImportPptx` function body in `pptx-actions.ts`:

```ts
export async function pickAndImportPptx(
  onProgress?: (p: {
    done: number;
    total: number;
    fileName: string;
  }) => void,
): Promise<{
  document: SlidesDocument;
  report: ImportReport;
  fileName: string;
} | null> {
  const file = await pickFile(".pptx");
  if (!file) return null;
  const buffer = await file.arrayBuffer();
  const { document, report } = await importPptx(buffer, {
    uploadImage: slidesImageUploader,
    onProgress: onProgress
      ? (done, total) => onProgress({ done, total, fileName: file.name })
      : undefined,
  });
  return { document, report, fileName: file.name };
}
```

- [ ] **Step 2: `pickAndImportDocx` accepts `onProgress`**

Replace the `pickAndImportDocx` function in `docx-actions.ts`:

```ts
export async function pickAndImportDocx(
  onProgress?: (p: {
    done: number;
    total: number;
    fileName: string;
  }) => void,
): Promise<{
  doc: DocsDocument;
  fileName: string;
} | null> {
  const file = await pickFile(".docx");
  if (!file) return null;
  const buffer = await file.arrayBuffer();
  const doc = await DocxImporter.import(
    buffer,
    docsImageUploader,
    onProgress
      ? (done, total) => onProgress({ done, total, fileName: file.name })
      : undefined,
  );
  return { doc, fileName: file.name };
}
```

- [ ] **Step 3: Typecheck both packages compile**

Run: `pnpm --filter @wafflebase/frontend exec tsc --noEmit`
Expected: no errors. (No commit yet — committed with Task 4, since the
new params are only consumed there.)

---

### Task 4: Document-list handlers drive the progress toast

**Files:**
- Modify: `packages/frontend/src/app/documents/document-list.tsx`

- [ ] **Step 1: Add a shared toast helper**

Just above `handleImportDocx` (after the `const [importing, ...]` line,
~228) add:

```ts
  // Lazily create (first tick) or update the import progress toast.
  // Returns the toast id so the caller can thread it to success/error.
  const updateImportToast = (
    toastId: string | number | undefined,
    title: string,
    done: number,
    total: number,
  ): string | number => {
    const description =
      total > 0
        ? `Uploading images ${Math.min(done, total)} / ${total}`
        : undefined;
    if (toastId === undefined) {
      return toast.loading(`Importing "${title}"…`, { description });
    }
    toast.loading(`Importing "${title}"…`, { id: toastId, description });
    return toastId;
  };
```

- [ ] **Step 2: Rewrite `handleImportDocx`**

```ts
  const handleImportDocx = async () => {
    if (importing) return;
    setImporting(true);
    let toastId: string | number | undefined;
    try {
      const result = await pickAndImportDocx(({ done, total, fileName }) => {
        const title =
          fileName.replace(/\.docx$/i, "") || "Imported Document";
        toastId = updateImportToast(toastId, title, done, total);
      });
      if (!result) {
        if (toastId !== undefined) toast.dismiss(toastId);
        return;
      }

      const title =
        result.fileName.replace(/\.docx$/i, "") || "Imported Document";
      const created = workspaceId
        ? await createWorkspaceDocument(workspaceId, { title, type: "doc" })
        : await createDocument({ title, type: "doc" });

      setPendingImport(String(created.id), result.doc);
      const message = `Imported "${title}"`;
      if (toastId !== undefined) toast.success(message, { id: toastId });
      else toast.success(message);
      navigate(getDocumentPath(created));
    } catch (err) {
      console.error("DOCX import failed", err);
      const message =
        err instanceof Error ? `Import failed: ${err.message}` : "Import failed";
      if (toastId !== undefined) toast.error(message, { id: toastId });
      else toast.error(message);
    } finally {
      setImporting(false);
    }
  };
```

- [ ] **Step 3: Rewrite `handleImportPptx`**

```ts
  const handleImportPptx = async () => {
    if (importing) return;
    setImporting(true);
    let toastId: string | number | undefined;
    try {
      const result = await pickAndImportPptx(({ done, total, fileName }) => {
        const title =
          fileName.replace(/\.pptx$/i, "") || "Imported Presentation";
        toastId = updateImportToast(toastId, title, done, total);
      });
      if (!result) {
        if (toastId !== undefined) toast.dismiss(toastId);
        return;
      }

      const title =
        result.fileName.replace(/\.pptx$/i, "") || "Imported Presentation";
      const created = workspaceId
        ? await createWorkspaceDocument(workspaceId, { title, type: "slides" })
        : await createDocument({ title, type: "slides" });

      setPendingPptxImport(String(created.id), result.document);
      const summary = result.report.summary();
      const message =
        summary === "Imported with no fallbacks."
          ? `Imported "${title}"`
          : `Imported "${title}" — ${summary}`;
      if (toastId !== undefined) toast.success(message, { id: toastId });
      else toast.success(message);
      navigate(getDocumentPath(created));
    } catch (err) {
      console.error("PPTX import failed", err);
      const message =
        err instanceof Error ? `Import failed: ${err.message}` : "Import failed";
      if (toastId !== undefined) toast.error(message, { id: toastId });
      else toast.error(message);
    } finally {
      setImporting(false);
    }
  };
```

- [ ] **Step 4: Typecheck + lint**

Run: `pnpm verify:fast`
Expected: lint + unit tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/app/slides/pptx-actions.ts \
        packages/frontend/src/app/docs/docx-actions.ts \
        packages/frontend/src/app/documents/document-list.tsx
git commit -m "Show import upload progress toast in the document list"
```

---

### Task 5: Verify, smoke-test, finish docs

- [ ] **Step 1: Full self-verify**

Run: `pnpm verify:self` (lint + unit tests + builds across packages).
Expected: green.

- [ ] **Step 2: Manual smoke in `pnpm dev`**

Import an image-heavy `.pptx` and `.docx` from the document list.
Confirm: a toast appears only after the file is chosen; the description
counts `X / N` upward; on completion it morphs into the existing success
toast; cancelling the picker shows no toast; an import error morphs into
the error toast.

- [ ] **Step 3: Fill in Risk notes + Review, capture lessons**

Update this todo's Risk notes / Review sections and write
`docs/tasks/active/20260525-import-progress-toast-lessons.md`. Run
`pnpm tasks:index`. Commit the docs.

- [ ] **Step 4: Self code-review + open PR**

Run a code-review pass over the branch diff (per CLAUDE.md step 3), then
`git fetch && git rebase origin/main` and open the PR.

## Risk notes

_(filled in during/after implementation)_

## Review

_(filled in after implementation)_
