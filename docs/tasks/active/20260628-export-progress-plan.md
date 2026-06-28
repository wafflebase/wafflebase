# Export Progress Reporting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show incremental, import-style toast progress for large docs/slides exports and keep the UI responsive by yielding the event loop between heavy work units.

**Architecture:** Each exporter gains an optional `onProgress(done, total, phase)` callback emitted per work unit (slide / page / image). Synchronous render loops (`drawSlide`, `paintPage`, `slideToXml`) `await yieldToPaint()` between units so the browser can repaint the toast. The frontend forwards the library `phase` string straight into a shared `updateExportToast` helper (the phase string — `slides`/`pages`/`images` — doubles as the toast unit label).

**Tech Stack:** TypeScript, Vitest (jsdom), Sonner toasts, React.

## Global Constraints

- Design doc: `docs/design/export-progress.md`.
- `onProgress` is always **optional**; CLI/Node/test callers omit it and behavior is unchanged.
- Emit contract per exporter: `(0, total, phase)` once before work, then monotonically increasing `done` after each unit, ending at `(total, total, phase)`.
- Phase strings are exactly `'slides'` (slides PDF + PPTX), `'pages'` (docs PDF), `'images'` (docs DOCX).
- Producer packages (`@wafflebase/docs`, `@wafflebase/slides`) are consumed as **built dist** by the frontend — rebuild them before the frontend typechecks (memory: packages-consume-built-dist).
- Docs imports use explicit `.js` extensions (NodeNext); slides imports use no extension. Match each package.
- `pnpm verify:fast` green before every commit.

---

### Task 1: Slides yield util + Slides PDF progress

**Files:**
- Create: `packages/slides/src/export/yield.ts`
- Modify: `packages/slides/src/export/pdf.ts` (`ExportSlidesPdfOptions` ~line 54-72; export loop ~line 129-163)
- Test: `packages/slides/test/export/pdf.test.ts` (append one `it`)

**Interfaces:**
- Produces: `yieldToPaint(): Promise<void>` from `./yield`.
- Produces: `ExportSlidesPdfOptions.onProgress?: (done: number, total: number, phase: string) => void`.

- [ ] **Step 1: Write the failing test**

Append inside the top-level `describe` block (after the existing `collectFontFamilies` describe) in `packages/slides/test/export/pdf.test.ts`. It reuses the file's existing `baseDoc` / `blankSlide` helpers and global stubs (`OffscreenCanvas`, `Image`, object-URL) set up in `beforeEach`.

```ts
describe('exportSlidesPdf progress', () => {
  it('reports monotonic per-slide progress ending at total', async () => {
    const { exportSlidesPdf } = await import('../../src/export/pdf');
    const doc = baseDoc([blankSlide('s1'), blankSlide('s2'), blankSlide('s3')]);
    const calls: Array<[number, number, string]> = [];
    await exportSlidesPdf(doc, {
      onProgress: (done, total, phase) => calls.push([done, total, phase]),
    });
    expect(calls[0]).toEqual([0, 3, 'slides']);
    expect(calls[calls.length - 1]).toEqual([3, 3, 'slides']);
    const dones = calls.map((c) => c[0]);
    expect(dones).toEqual([...dones].sort((a, b) => a - b)); // non-decreasing
    expect(calls.every((c) => c[1] === 3 && c[2] === 'slides')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/slides test -- pdf.test.ts`
Expected: FAIL — `onProgress` is not a known option / callback never invoked (`calls[0]` is `undefined`).

- [ ] **Step 3: Create the yield util**

Create `packages/slides/src/export/yield.ts`:

```ts
/**
 * Resolve on the next macrotask so the browser can paint between heavy
 * synchronous export units (per-slide canvas raster, per-slide XML). A
 * `MessageChannel` macrotask avoids `setTimeout`'s ~4 ms clamp; falls back
 * to `setTimeout(0)` where `MessageChannel` is unavailable (older Node).
 */
export function yieldToPaint(): Promise<void> {
  if (typeof MessageChannel === 'undefined') {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(0);
  });
}
```

- [ ] **Step 4: Add the option and emit + yield in the loop**

In `packages/slides/src/export/pdf.ts`:

Add the import near the other view imports (top of file):

```ts
import { yieldToPaint } from './yield';
```

Add the field to `ExportSlidesPdfOptions` (after `title?: string;`):

```ts
  /** Progress callback: `(done, total, 'slides')` once before work, then after each rendered slide. */
  onProgress?: (done: number, total: number, phase: string) => void;
```

Replace the export loop (the `try { for (const slide of doc.slides) { … } } finally { … }` block) so it emits and yields. The body of the loop is unchanged — only the `onProgress` / `done` / `yieldToPaint` lines are added:

```ts
  const onProgress = opts.onProgress;
  const total = doc.slides.length;
  onProgress?.(0, total, 'slides');

  try {
    let done = 0;
    for (const slide of doc.slides) {
      const cloned = prepareExportSlide(slide, doc, map);

      const srcs = imageSrcsToPreload(cloned);
      await Promise.all(srcs.map((s) => awaitImageLoaded(s, assetTimeoutMs)));

      const canvas = createExportCanvas(
        Math.round(SLIDE_WIDTH * scale),
        Math.round(SLIDE_HEIGHT * scale),
      );
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Failed to acquire a 2D context for PDF export.');
      }
      drawSlide(ctx as unknown as CanvasRenderingContext2D, cloned, doc, {
        hostWidth: SLIDE_WIDTH,
        hostHeight: SLIDE_HEIGHT,
        dpr: scale,
      });

      const bytes = await canvasToBytes(canvas, format, quality);
      const image =
        format === 'jpeg' ? await pdf.embedJpg(bytes) : await pdf.embedPng(bytes);
      const page = pdf.addPage([pageWidth, pageHeight]);
      page.drawImage(image, { x: 0, y: 0, width: pageWidth, height: pageHeight });

      done += 1;
      onProgress?.(done, total, 'slides');
      if (done < total) await yieldToPaint();
    }
  } finally {
    if (temp.length > 0) {
      evictImageSrcs(temp);
      for (const url of temp) URL.revokeObjectURL(url);
    }
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/slides test -- pdf.test.ts`
Expected: PASS (both the new progress test and the existing PDF tests).

- [ ] **Step 6: Commit**

```bash
git add packages/slides/src/export/yield.ts packages/slides/src/export/pdf.ts packages/slides/test/export/pdf.test.ts
git commit -m "Slides PDF export: report per-slide progress and yield to paint"
```

---

### Task 2: Slides PPTX progress (library only)

PPTX export has **no frontend trigger** today (`exportPptx` is unreferenced in `packages/frontend`; only CLI/Node use it). This task adds the library-level callback for parity and future UI wiring — there is no toast wiring step.

**Files:**
- Modify: `packages/slides/src/export/pptx/index.ts` (`ExportPptxOptions` ~line 61-72; slide loop ~line 267-341)
- Test: Create `packages/slides/test/export/pptx/progress.test.ts`

**Interfaces:**
- Consumes: `yieldToPaint` from `../yield` (created in Task 1).
- Produces: `ExportPptxOptions.onProgress?: (done: number, total: number, phase: string) => void`.

- [ ] **Step 1: Write the failing test**

Create `packages/slides/test/export/pptx/progress.test.ts`. Mirror the deck-building style used by the sibling pptx tests (e.g. `slide.test.ts`) — a minimal image-free deck so `fetchImage` is unnecessary.

```ts
import { describe, it, expect } from 'vitest';
import { exportPptx } from '../../../src/export/pptx/index';
import type { Slide, SlidesDocument } from '../../../src/model/presentation';
import { DEFAULT_BACKGROUND } from '../../../src/model/presentation';
import { DEFAULT_MASTER } from '../../../src/model/master';
import { BUILT_IN_LAYOUTS } from '../../../src/model/layout';
import { BUILT_IN_THEMES } from '../../../src/model/theme';

const blankSlide = (id: string): Slide => ({
  id,
  layoutId: 'blank',
  background: { ...DEFAULT_BACKGROUND },
  elements: [],
  notes: [],
});

const deck = (slides: Slide[]): SlidesDocument => ({
  meta: { title: 'Deck', themeId: BUILT_IN_THEMES[0].id, masterId: 'default' },
  themes: [BUILT_IN_THEMES[0]],
  masters: [DEFAULT_MASTER],
  layouts: BUILT_IN_LAYOUTS,
  slides,
  guides: [],
});

describe('exportPptx progress', () => {
  it('reports monotonic per-slide progress ending at total', async () => {
    const calls: Array<[number, number, string]> = [];
    await exportPptx(deck([blankSlide('s1'), blankSlide('s2')]), {
      onProgress: (done, total, phase) => calls.push([done, total, phase]),
    });
    expect(calls[0]).toEqual([0, 2, 'slides']);
    expect(calls[calls.length - 1]).toEqual([2, 2, 'slides']);
    expect(calls.every((c) => c[1] === 2 && c[2] === 'slides')).toBe(true);
  });
});
```

> If `BUILT_IN_THEMES` / `DEFAULT_MASTER` / `BUILT_IN_LAYOUTS` import paths differ, copy the exact imports from an existing passing test in `packages/slides/test/export/pptx/` rather than guessing.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/slides test -- progress.test.ts`
Expected: FAIL — `calls` is empty (`calls[0]` is `undefined`).

- [ ] **Step 3: Add the option and emit + yield in the slide loop**

In `packages/slides/src/export/pptx/index.ts`:

Add the import next to the other local imports (with the `.js` extension this package's index uses elsewhere — note: confirm; this file uses `.js` extensions):

```ts
import { yieldToPaint } from '../yield.js';
```

Add the field to `ExportPptxOptions` (after the `fetchImage?` field):

```ts
  /** Progress callback: `(done, total, 'slides')` once before work, then after each serialized slide. */
  onProgress?: (done: number, total: number, phase: string) => void;
```

Just before the slide loop (`for (let i = 0; i < deck.slides.length; i++) {`), emit the initial tick:

```ts
  const onProgress = opts.onProgress;
  const slideTotal = deck.slides.length;
  onProgress?.(0, slideTotal, 'slides');
```

At the **end** of the loop body, immediately after `slideRIds.push(slideRId);`, add:

```ts
    onProgress?.(i + 1, slideTotal, 'slides');
    if (i + 1 < slideTotal) await yieldToPaint();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/slides test -- progress.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/slides/src/export/pptx/index.ts packages/slides/test/export/pptx/progress.test.ts
git commit -m "Slides PPTX export: report per-slide progress and yield to paint"
```

---

### Task 3: Docs yield util + Docs PDF progress

**Files:**
- Create: `packages/docs/src/export/yield.ts`
- Modify: `packages/docs/src/export/pdf-exporter.ts` (`PdfExportOptions` ~line 30-50; per-page loop ~line 137-159)
- Test: `packages/docs/test/export/pdf-exporter.test.ts` (append one `it`)

**Interfaces:**
- Produces: `yieldToPaint(): Promise<void>` from `./yield.js`.
- Produces: `PdfExportOptions.onProgress?: (done: number, total: number, phase: string) => void`.

- [ ] **Step 1: Write the failing test**

Open `packages/docs/test/export/pdf-exporter.test.ts`, read the top to find how it builds a `Document` and which `measurer` stub it passes to `PdfExporter.export`. Append a test that reuses that exact pattern. Template (adapt the doc/measurer construction to match the file's existing helpers):

```ts
it('reports per-page progress ending at total', async () => {
  const doc = makeDoc(); // reuse the file's existing doc-builder/fixture
  const calls: Array<[number, number, string]> = [];
  await PdfExporter.export(doc, {
    measurer: makeMeasurer(), // reuse the file's existing measurer stub
    onProgress: (done, total, phase) => calls.push([done, total, phase]),
  });
  expect(calls[0][0]).toBe(0);
  expect(calls[0][2]).toBe('pages');
  const last = calls[calls.length - 1];
  expect(last[0]).toBe(last[1]); // done === total at the end
  expect(last[1]).toBeGreaterThan(0);
  const dones = calls.map((c) => c[0]);
  expect(dones).toEqual([...dones].sort((a, b) => a - b));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/docs test -- pdf-exporter.test.ts`
Expected: FAIL — `calls` empty (`calls[0]` undefined).

- [ ] **Step 3: Create the yield util**

Create `packages/docs/src/export/yield.ts` (identical body to the slides copy):

```ts
/**
 * Resolve on the next macrotask so the browser can paint between heavy
 * synchronous export units (per-page PDF paint). A `MessageChannel`
 * macrotask avoids `setTimeout`'s ~4 ms clamp; falls back to `setTimeout(0)`
 * where `MessageChannel` is unavailable (older Node).
 */
export function yieldToPaint(): Promise<void> {
  if (typeof MessageChannel === 'undefined') {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(0);
  });
}
```

- [ ] **Step 4: Add the option and emit + yield in the per-page loop**

In `packages/docs/src/export/pdf-exporter.ts`:

Add the import beside the other `./` imports (with `.js`):

```ts
import { yieldToPaint } from './yield.js';
```

Add the field to `PdfExportOptions` (after `fontResolver?`):

```ts
  /** Progress callback: `(done, total, 'pages')` once before paint, then after each painted page. */
  onProgress?: (done: number, total: number, phase: string) => void;
```

The per-page loop must become awaitable. Change the loop at lines ~137-159 to emit and yield. Note `export()` is already `async`, so adding `await` inside is safe:

```ts
    const blockIdToPage = new Map<string, number>();
    const onProgress = opts.onProgress;
    const pageTotal = pagination.pages.length;
    onProgress?.(0, pageTotal, 'pages');
    for (let i = 0; i < pageTotal; i++) {
      const lp = pagination.pages[i];
      const pageWidthPt = lp.width / PX_PER_PT;
      const pageHeightPt = lp.height / PX_PER_PT;
      const page = pdfDoc.addPage([pageWidthPt, pageHeightPt]);
      PdfPainter.paintPage(page, lp, pagination.pageSetup, embeddedFonts, {
        doc,
        imageMap,
        pageNumber: i + 1,
        headerLayout,
        footerLayout,
        listCounters,
        layoutBlocks: layout.blocks,
        embeddableFamilies,
      });

      for (const pl of lp.lines) {
        const block = layout.blocks[pl.blockIndex]?.block;
        if (block && !blockIdToPage.has(block.id)) {
          blockIdToPage.set(block.id, i);
        }
      }

      onProgress?.(i + 1, pageTotal, 'pages');
      if (i + 1 < pageTotal) await yieldToPaint();
    }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/docs test -- pdf-exporter.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/docs/src/export/yield.ts packages/docs/src/export/pdf-exporter.ts packages/docs/test/export/pdf-exporter.test.ts
git commit -m "Docs PDF export: report per-page progress and yield to paint"
```

---

### Task 4: Docs DOCX progress (image fetches)

DOCX's freeze is dominated by image fetches, which already `await` (so they yield naturally) — this task adds **progress reporting only**, mirroring the import "Embedding images X / Y" UX. No `yieldToPaint`.

**Files:**
- Modify: `packages/docs/src/export/docx-exporter.ts` (`export()` signature ~line 34-63; add a `countImageSrcs` helper)
- Test: `packages/docs/test/export/docx-exporter.test.ts` (append one `it`)

**Interfaces:**
- Produces: `DocxExporter.export(doc, imageFetcher?, onProgress?)` where `onProgress?: (done: number, total: number, phase: string) => void`.

- [ ] **Step 1: Write the failing test**

Append to `packages/docs/test/export/docx-exporter.test.ts` (the file already polyfills `Blob.arrayBuffer`). Build a doc with two image inlines and a stub fetcher:

```ts
it('reports per-image progress ending at total', async () => {
  const PNG = new Blob(
    [Uint8Array.from(atob(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAen63NgAAAAASUVORK5CYII='
    ), (c) => c.charCodeAt(0))],
    { type: 'image/png' },
  );
  const doc: Document = {
    blocks: [{
      id: generateBlockId(),
      type: 'paragraph',
      inlines: [
        { text: '', style: { image: { src: 'a.png', width: 10, height: 10 } } },
        { text: '', style: { image: { src: 'b.png', width: 10, height: 10 } } },
      ],
      style: { ...DEFAULT_BLOCK_STYLE },
    }],
  };
  const calls: Array<[number, number, string]> = [];
  await DocxExporter.export(doc, async () => PNG, (d, t, p) => calls.push([d, t, p]));
  expect(calls[0]).toEqual([0, 2, 'images']);
  expect(calls[calls.length - 1]).toEqual([2, 2, 'images']);
  expect(calls.every((c) => c[2] === 'images')).toBe(true);
});
```

> Confirm the inline `image` style shape (`src`/`width`/`height`) against `packages/docs/src/model/types.ts`; copy the exact field names if they differ.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/docs test -- docx-exporter.test.ts`
Expected: FAIL — `onProgress` is not accepted / `calls` empty.

- [ ] **Step 3: Add the parameter, total count, and wrapped fetcher**

In `packages/docs/src/export/docx-exporter.ts`, change the `export` signature and wrap the fetcher. Replace lines 34-63 (signature through the first `collectImages` body-loop) with:

```ts
  static async export(
    doc: Document,
    imageFetcher?: ImageFetcher,
    onProgress?: (done: number, total: number, phase: string) => void,
  ): Promise<Blob> {
    const zip = new JSZip();
    const docImageEntries: ImageEntry[] = [];
    const headerImageEntries: ImageEntry[] = [];
    const footerImageEntries: ImageEntry[] = [];
    const makeCounter = () => {
      let n = 10; // Start after reserved IDs
      return () => `rId${n++}`;
    };
    const nextDocRId = makeCounter();
    const nextHeaderRId = makeCounter();
    const nextFooterRId = makeCounter();
    let mediaSeq = 0;
    const nextMediaName = (ext: string) => `media/image_${++mediaSeq}.${ext}`;

    // Progress: total = unique image srcs per part (matches the per-part
    // dedupe in collectImages). Wrap the fetcher to emit after each fetch,
    // in a `finally` so a failed fetch still advances the bar.
    let imagesDone = 0;
    const imagesTotal = onProgress
      ? DocxExporter.countImageSrcs(doc.blocks) +
        DocxExporter.countImageSrcs(doc.header?.blocks) +
        DocxExporter.countImageSrcs(doc.footer?.blocks)
      : 0;
    onProgress?.(0, imagesTotal, 'images');
    const fetcher: ImageFetcher | undefined =
      imageFetcher && onProgress
        ? async (url: string) => {
            try {
              return await imageFetcher(url);
            } finally {
              imagesDone += 1;
              onProgress(imagesDone, imagesTotal, 'images');
            }
          }
        : imageFetcher;

    // Collect and fetch images referenced from the main document body.
    if (fetcher) {
      for (const block of doc.blocks) {
        await DocxExporter.collectImages(block, fetcher, zip, docImageEntries, nextDocRId, nextMediaName);
      }
    }
```

Then update the **header** and **footer** image-collection calls (lines ~74-78 and ~86-90) to use `fetcher` instead of `imageFetcher` in both the `if (...)` guard and the `collectImages(...)` argument:

```ts
      if (fetcher) {
        for (const block of doc.header.blocks) {
          await DocxExporter.collectImages(block, fetcher, zip, headerImageEntries, nextHeaderRId, nextMediaName);
        }
      }
```

```ts
      if (fetcher) {
        for (const block of doc.footer.blocks) {
          await DocxExporter.collectImages(block, fetcher, zip, footerImageEntries, nextFooterRId, nextMediaName);
        }
      }
```

- [ ] **Step 4: Add the `countImageSrcs` helper**

Add this private static method to the `DocxExporter` class (e.g. just above `collectImages`):

```ts
  /** Unique image srcs in a block list (incl. table cells), matching the
   *  per-part dedupe in `collectImages` so the count equals fetch calls. */
  private static countImageSrcs(blocks: Block[] | undefined): number {
    if (!blocks) return 0;
    const srcs = new Set<string>();
    const walk = (block: Block): void => {
      for (const inline of block.inlines) {
        if (inline.style.image) srcs.add(inline.style.image.src);
      }
      if (block.tableData) {
        for (const row of block.tableData.rows) {
          for (const cell of row.cells) {
            for (const cellBlock of cell.blocks) walk(cellBlock);
          }
        }
      }
    };
    for (const block of blocks) walk(block);
    return srcs.size;
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/docs test -- docx-exporter.test.ts`
Expected: PASS (new test + existing round-trip tests unaffected — they call `export(doc)` / `export(doc, fetcher)` with no `onProgress`, so the wrapper stays inactive).

- [ ] **Step 6: Commit**

```bash
git add packages/docs/src/export/docx-exporter.ts packages/docs/test/export/docx-exporter.test.ts
git commit -m "Docs DOCX export: report per-image embedding progress"
```

---

### Task 5: Frontend toast wiring (docs PDF, docs DOCX, slides PDF)

Wires the new callbacks into an import-style Sonner toast. PPTX has no UI trigger, so it is intentionally not wired here.

**Files:**
- Modify: `packages/frontend/src/app/docs/export-utils.ts` (add `updateExportToast`)
- Modify: `packages/frontend/src/app/docs/pdf-actions.ts` (`exportPdfAndDownload`)
- Modify: `packages/frontend/src/app/docs/docx-actions.ts` (`exportDocxAndDownload`)
- Modify: `packages/frontend/src/app/slides/pdf-actions.ts` (`exportSlidesPdfAndDownload`)
- Modify: `packages/frontend/src/app/docs/docs-export-button.tsx` (`runExport`)
- Modify: `packages/frontend/src/app/slides/slides-export-button.tsx` (`handleExportPdf`)

**Interfaces:**
- Consumes: `PdfExportOptions.onProgress`, `ExportSlidesPdfOptions.onProgress`, `DocxExporter.export(…, onProgress)` from Tasks 1/3/4.
- Produces: `updateExportToast(toastId, title, done, total, unit): string | number`.
- Produces (action signatures): all three take `onProgress?: (done: number, total: number, phase: string) => void` and forward the library `phase` straight through; the button uses `phase` as the toast `unit`.

- [ ] **Step 1: Rebuild producer packages so the frontend sees the new options**

Run: `pnpm --filter @wafflebase/docs build && pnpm --filter @wafflebase/slides build`
Expected: both builds succeed (the new `onProgress` fields are now in dist `.d.ts`).

- [ ] **Step 2: Add the `updateExportToast` helper**

In `packages/frontend/src/app/docs/export-utils.ts`, add a `sonner` import at the top:

```ts
import { toast } from "sonner";
```

Append the helper (mirrors `updateImportToast` in `document-list.tsx`):

```ts
/**
 * Lazily create (first tick) or update the export progress toast, mirroring
 * the import toast. `unit` is the exporter's phase string ("slides" | "pages"
 * | "images"). Returns the toast id so the caller can thread it to
 * success/error.
 */
export function updateExportToast(
  toastId: string | number | undefined,
  title: string,
  done: number,
  total: number,
  unit: string,
): string | number {
  const description =
    total > 0 ? `${Math.min(done, total)} / ${total} ${unit}` : undefined;
  if (toastId === undefined) {
    return toast.loading(`Exporting "${title}"…`, { description });
  }
  toast.loading(`Exporting "${title}"…`, { id: toastId, description });
  return toastId;
}
```

- [ ] **Step 3: Thread `onProgress` through the three actions**

`packages/frontend/src/app/docs/pdf-actions.ts` — add `onProgress` (before the optional `metadata`, so the button can pass it positionally) and forward it:

```ts
export async function exportPdfAndDownload(
  doc: DocsDocument,
  title: string,
  onProgress?: (done: number, total: number, phase: string) => void,
  metadata?: { title?: string; author?: string },
): Promise<void> {
  const { PdfExporter, CanvasTextMeasurer } = await import("@wafflebase/docs");
  const { FONT_FILES } = await import(
    "../../components/text-formatting/font-files.data"
  );
  const blob = await PdfExporter.export(doc, {
    imageFetcher: docsImageFetcher,
    metadata: { title: metadata?.title ?? title, author: metadata?.author },
    measurer: new CanvasTextMeasurer(),
    fontResolver: (family) => FONT_FILES[family],
    onProgress,
  });
  downloadBlob(blob, safeFilename(title, "pdf"));
}
```

`packages/frontend/src/app/docs/docx-actions.ts` — `exportDocxAndDownload`:

```ts
export async function exportDocxAndDownload(
  doc: DocsDocument,
  title: string,
  onProgress?: (done: number, total: number, phase: string) => void,
): Promise<void> {
  const blob = await DocxExporter.export(doc, docsImageFetcher, onProgress);
  downloadBlob(blob, safeFilename(title, "docx"));
}
```

`packages/frontend/src/app/slides/pdf-actions.ts` — `exportSlidesPdfAndDownload`:

```ts
export async function exportSlidesPdfAndDownload(
  doc: SlidesDocument,
  title: string,
  onProgress?: (done: number, total: number, phase: string) => void,
): Promise<void> {
  const families = collectFontFamilies(doc);
  for (const family of families) ensureFontLink(family);
  if (typeof document !== "undefined" && document.fonts) {
    await Promise.all(
      families.map((family) =>
        document.fonts.load(`16px "${family}"`).catch(() => {
          /* a single font failing to load must not abort the export */
        }),
      ),
    );
  }

  const bytes = await exportSlidesPdf(doc, {
    imageFetcher: docsImageFetcher,
    title,
    onProgress,
  });
  const blob = new Blob([bytes], { type: "application/pdf" });
  downloadBlob(blob, safeFilename(title, "pdf"));
}
```

- [ ] **Step 4: Wire the docs export button toast**

In `packages/frontend/src/app/docs/docs-export-button.tsx`, import the helper and rewrite `runExport` to manage the toast lifecycle:

```ts
import { updateExportToast } from "./export-utils";
```

```ts
  const runExport = async (
    kind: "docx" | "pdf",
    fn: (
      doc: ReturnType<ReturnType<EditorAPI["getStore"]>["getDocument"]>,
      title: string,
      onProgress?: (done: number, total: number, phase: string) => void,
    ) => Promise<void>,
  ) => {
    if (!editor || exporting) return;
    setExporting(true);
    const t = title || "document";
    let toastId: string | number | undefined;
    try {
      await fn(editor.getStore().getDocument(), t, (done, total, phase) => {
        toastId = updateExportToast(toastId, t, done, total, phase);
      });
      const message = `Exported "${t}"`;
      if (toastId !== undefined) toast.success(message, { id: toastId });
      else toast.success(message);
    } catch (err) {
      console.error(`${kind.toUpperCase()} export failed`, err);
      const message =
        err instanceof Error ? `Export failed: ${err.message}` : "Export failed";
      if (toastId !== undefined) toast.error(message, { id: toastId });
      else toast.error(message);
    } finally {
      setExporting(false);
    }
  };
```

> If the inline `fn` type is awkward against the imported function types, define a local
> `type ExportAction = (doc: DocsDocument, title: string, onProgress?: (d: number, t: number, p: string) => void) => Promise<void>;`
> (importing `Document as DocsDocument` from `@wafflebase/docs`) and type `fn: ExportAction`. The `onSelect` call sites (`runExport("docx", exportDocxAndDownload)` / `runExport("pdf", exportPdfAndDownload)`) stay unchanged.

- [ ] **Step 5: Wire the slides export button toast**

In `packages/frontend/src/app/slides/slides-export-button.tsx`:

```ts
import { updateExportToast } from "../docs/export-utils";
```

```ts
  const handleExportPdf = async () => {
    if (!store) return;
    setExporting(true);
    const t = title || "presentation";
    let toastId: string | number | undefined;
    try {
      await exportSlidesPdfAndDownload(store.read(), t, (done, total, phase) => {
        toastId = updateExportToast(toastId, t, done, total, phase);
      });
      const message = `Exported "${t}"`;
      if (toastId !== undefined) toast.success(message, { id: toastId });
      else toast.success(message);
    } catch (err) {
      console.error("Slides PDF export failed", err);
      const message =
        err instanceof Error ? `Export failed: ${err.message}` : "Export failed";
      if (toastId !== undefined) toast.error(message, { id: toastId });
      else toast.error(message);
    } finally {
      setExporting(false);
    }
  };
```

- [ ] **Step 6: Verify the frontend typechecks and the lane is green**

Run: `pnpm verify:fast`
Expected: PASS (lint + unit tests across packages, including the new exporter tests).

- [ ] **Step 7: Manual smoke (UI changed)**

Run `pnpm dev`, open a large deck and a large doc, and export PDF/DOCX. Confirm: the toast appears and counts up (`12 / 50 slides`, `8 / 120 pages`, `3 / 5 images`), the UI stays responsive during export, and a success toast replaces the loading toast when the download fires.

- [ ] **Step 8: Commit**

```bash
git add packages/frontend/src/app/docs/export-utils.ts \
        packages/frontend/src/app/docs/pdf-actions.ts \
        packages/frontend/src/app/docs/docx-actions.ts \
        packages/frontend/src/app/slides/pdf-actions.ts \
        packages/frontend/src/app/docs/docs-export-button.tsx \
        packages/frontend/src/app/slides/slides-export-button.tsx
git commit -m "Frontend: show import-style toast progress during docs/slides export"
```

---

## Self-Review

**Spec coverage:**
- Slides PDF progress + responsiveness → Task 1 ✅
- Slides PPTX progress (library) → Task 2 ✅ (no UI trigger exists; documented)
- Docs PDF progress + responsiveness → Task 3 ✅
- Docs DOCX progress (image fetches) → Task 4 ✅
- Import-style toast UX, shared helper → Task 5 ✅
- `yieldToPaint` (MessageChannel + setTimeout fallback) → Tasks 1 & 3 ✅
- Optional callback / unchanged CLI+test behavior → enforced by optional params; existing tests call exporters without `onProgress` ✅

**Placeholder scan:** No TBD/TODO. Two "confirm the exact shape against the source" notes (DOCX inline image fields; PPTX fixture imports) are deliberate guards against guessed field names, each with the file to check — not deferred work.

**Type consistency:** `onProgress?: (done: number, total: number, phase: string) => void` is identical across `ExportSlidesPdfOptions`, `ExportPptxOptions`, `PdfExportOptions`, `DocxExporter.export`, and all three frontend actions. `yieldToPaint(): Promise<void>` identical in both packages. `updateExportToast(toastId, title, done, total, unit)` consumes `phase` as `unit`. Phase strings `'slides'`/`'pages'`/`'images'` are consistent between emit sites and tests.
