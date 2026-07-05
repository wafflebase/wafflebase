/**
 * Slides PDF export — P0 raster pipeline.
 *
 * Renders every slide through the *existing* `drawSlide()` canvas
 * pipeline (so shapes, images, tables, connectors, groups, effects,
 * theme colors and background images all match the editor exactly) onto
 * a high-DPI offscreen canvas, then embeds one bitmap per page into a
 * `pdf-lib` document sized 13.333" × 7.5" (the default 16:9 deck).
 *
 * Why raster, not vector: the docs `PdfPainter` only knows paragraphs /
 * tables / images, whereas a slide carries 100+ shape kinds, freeform
 * paths, connectors, rotations and effects. Reusing the canvas renderer
 * is pixel-identical for a fraction of the effort. Trade-off: PDF text
 * is not selectable (a vector text overlay is the planned P1). See
 * `docs/design/slides/slides-pdf-export.md`.
 *
 * Cross-origin tainting: production serves images from a different
 * origin and the editor loads them via a plain `img.src` (no CORS), so
 * drawing them and then calling `toBlob` would taint the canvas and
 * throw. The exporter therefore fetches each image's bytes (with
 * credentials, via the injected `imageFetcher`) into a same-origin
 * object URL, clones each slide with the rewritten srcs, and renders the
 * clone — the editor's slides and shared image cache are never mutated.
 *
 * Browser-only: depends on DOM `Image`, `OffscreenCanvas`/`<canvas>` and
 * `document.fonts`. Node consumers cannot use this entry.
 */
import type { Element, TextBody } from '../model/element';
import type {
  BackgroundImage,
  Slide,
  SlidesDocument,
} from '../model/presentation';
import {
  SLIDE_WIDTH,
  deckSlideHeight,
  resolveBackgroundImage,
} from '../model/presentation';
import { drawSlide } from '../view/canvas/slide-renderer';
import {
  evictImageSrcs,
  getOrLoadImage,
  isImageFailed,
} from '../view/canvas/image-cache';
import { yieldToPaint } from './yield';

/**
 * Fetches the raw bytes of an image `src`. Supplied by the frontend so
 * the export can pull cross-origin (backend-hosted) images with auth
 * cookies into a taint-free object URL. Omit it only for decks whose
 * images are all `data:`/`blob:` (e.g. tests) or genuinely same-origin.
 */
export type SlidesImageFetcher = (src: string) => Promise<Blob>;

export interface ExportSlidesPdfOptions {
  /**
   * Bitmap supersampling factor per slide. Default `2` →
   * 3840 × 2160 source bitmap, scaled into the 960 × 540 pt page so
   * text / shape edges stay crisp. Geometry is unaffected — only
   * sharpness and file size scale with this.
   */
  scale?: number;
  /** Encoding of the per-page bitmap. `'png'` (default, lossless) or `'jpeg'` (smaller, photo-heavy decks). */
  format?: 'png' | 'jpeg';
  /** JPEG quality `0..1`. Default `0.92`. Ignored for PNG. */
  quality?: number;
  /** Fetch http(s) image bytes with credentials to avoid canvas tainting. */
  imageFetcher?: SlidesImageFetcher;
  /** Per-slide image-load timeout in ms before painting with whatever loaded. Default `15000`. */
  assetTimeoutMs?: number;
  /** Title written into the PDF metadata. */
  title?: string;
  /** Progress callback: `(done, total, 'slides')` once before work, then after each rendered slide. */
  onProgress?: (done: number, total: number, phase: string) => void;
}

// 1×1 transparent PNG. Used as a taint-free stand-in for images whose
// bytes could not be fetched, so a broken/forbidden URL renders blank
// instead of either tainting the canvas (original cross-origin src) or
// hanging on an unreliable empty-src `onerror`.
const BLANK_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HBwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

// PDF page width in points for the default 16:9 deck (13.333" × 72).
const PAGE_WIDTH_PT = 960;

type ExportCanvas = OffscreenCanvas | HTMLCanvasElement;

/**
 * Export the whole presentation as a multi-page PDF (one slide per
 * page) and return the encoded bytes. Callers wrap the result in a
 * `Blob` and trigger a download.
 *
 * The caller is responsible for ensuring every font the deck uses is
 * loaded into `document.fonts` before calling (see
 * {@link collectFontFamilies}); the exporter awaits `document.fonts.ready`
 * defensively but cannot initiate lazy font CSS itself.
 */
export async function exportSlidesPdf(
  doc: SlidesDocument,
  opts: ExportSlidesPdfOptions = {},
): Promise<Uint8Array> {
  if (doc.slides.length === 0) {
    throw new Error('Cannot export an empty presentation to PDF.');
  }

  const scale = opts.scale ?? 2;
  const format = opts.format ?? 'png';
  const quality = opts.quality ?? 0.92;
  const assetTimeoutMs = opts.assetTimeoutMs ?? 15000;

  // Dynamic import keeps pdf-lib (~150 KB) out of the editor bundle —
  // it loads only when the user actually exports.
  const { PDFDocument } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  if (opts.title) pdf.setTitle(opts.title);

  // Resolve any font loads the caller kicked off so text measures and
  // paints with the intended glyphs rather than a fallback.
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      /* font readiness is best-effort */
    }
  }

  const { map, temp } = await resolveDeckImages(doc, opts.imageFetcher);
  // Per-deck logical height. Width maps to the fixed 13.333"/960-pt page;
  // a 4:3 deck (height 1440) yields a taller 720-pt (10") page so the PDF
  // preserves the deck's real aspect instead of forcing 16:9.
  const slideH = deckSlideHeight(doc.meta);
  const pageWidth = PAGE_WIDTH_PT;
  const pageHeight = (slideH / SLIDE_WIDTH) * PAGE_WIDTH_PT;

  const onProgress = opts.onProgress;
  const total = doc.slides.length;

  try {
    // Emit inside the try so a throwing callback can't skip the finally that
    // revokes the temp object URLs allocated by resolveDeckImages() above.
    let done = 0;
    onProgress?.(0, total, 'slides');
    for (const slide of doc.slides) {
      const cloned = prepareExportSlide(slide, doc, map);

      // Preload this slide's (now taint-free) image srcs so the single
      // paint below draws them instead of skipping still-loading ones.
      const srcs = imageSrcsToPreload(cloned);
      await Promise.all(srcs.map((s) => awaitImageLoaded(s, assetTimeoutMs)));

      const canvas = createExportCanvas(
        Math.round(SLIDE_WIDTH * scale),
        Math.round(slideH * scale),
      );
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Failed to acquire a 2D context for PDF export.');
      }
      drawSlide(ctx as unknown as CanvasRenderingContext2D, cloned, doc, {
        hostWidth: SLIDE_WIDTH,
        hostHeight: slideH,
        dpr: scale,
      });

      const bytes = await canvasToBytes(canvas, format, quality);
      const image =
        format === 'jpeg' ? await pdf.embedJpg(bytes) : await pdf.embedPng(bytes);
      const page = pdf.addPage([pageWidth, pageHeight]);
      page.drawImage(image, { x: 0, y: 0, width: pageWidth, height: pageHeight });

      done += 1;
      onProgress?.(done, total, 'slides');
      // Only yield when progress is being reported — i.e. the interactive
      // (browser) path. Headless/CLI exports gain nothing from the extra
      // event-loop turn.
      if (onProgress && done < total) await yieldToPaint();
    }
  } finally {
    if (temp.length > 0) {
      evictImageSrcs(temp);
      for (const url of temp) URL.revokeObjectURL(url);
    }
  }

  return pdf.save();
}

/**
 * Every distinct font family the deck references — the two theme fonts
 * (heading/body) per theme plus every explicit inline `fontFamily`.
 * The frontend loads each into `document.fonts` before export so
 * un-viewed slides (whose lazy Google Fonts never loaded) still render
 * with the right glyphs.
 */
export function collectFontFamilies(doc: SlidesDocument): string[] {
  const families = new Set<string>();
  for (const theme of doc.themes) {
    if (theme.fonts?.heading) families.add(theme.fonts.heading);
    if (theme.fonts?.body) families.add(theme.fonts.body);
  }
  for (const slide of doc.slides) {
    for (const el of flattenElements(slide.elements)) {
      for (const body of textBodiesOf(el)) {
        for (const block of body.blocks) {
          // List-item bullets can carry their own font (PPTX `<a:buFont>`),
          // painted by the docs marker path independent of the inlines.
          if (block.marker?.fontFamily) families.add(block.marker.fontFamily);
          for (const inline of block.inlines) {
            if (inline.style.fontFamily) families.add(inline.style.fontFamily);
          }
        }
      }
    }
  }
  return Array.from(families);
}

// --- internals ------------------------------------------------------

/** Flatten the element tree, recursing into groups, into a single list. */
function flattenElements(elements: readonly Element[]): Element[] {
  const out: Element[] = [];
  const walk = (list: readonly Element[]): void => {
    for (const el of list) {
      out.push(el);
      if (el.type === 'group') walk(el.data.children);
    }
  };
  walk(elements);
  return out;
}

/** Every text body carried by an element (text box, shape text, table cells). */
function textBodiesOf(el: Element): TextBody[] {
  if (el.type === 'text') return [el.data];
  if (el.type === 'shape') return el.data.text ? [el.data.text] : [];
  if (el.type === 'table') {
    const bodies: TextBody[] = [];
    for (const row of el.data.rows) {
      for (const cell of row.cells) bodies.push(cell.body);
    }
    return bodies;
  }
  return [];
}


/**
 * Pull every cross-origin image in the deck into a taint-free object
 * URL, returning a `src → usableSrc` map plus the temp URLs to revoke.
 * `data:`/`blob:` srcs pass through untouched; fetch failures map to a
 * blank PNG so a forbidden URL renders empty rather than tainting.
 */
async function resolveDeckImages(
  doc: SlidesDocument,
  fetcher: SlidesImageFetcher | undefined,
): Promise<{ map: Map<string, string>; temp: string[] }> {
  const originals = new Set<string>();
  for (const slide of doc.slides) {
    for (const el of flattenElements(slide.elements)) {
      if (el.type === 'image' && el.data.src) originals.add(el.data.src);
    }
    const bg = resolveBackgroundImage(slide, doc)?.src;
    if (bg) originals.add(bg);
  }

  // Fetch all images concurrently — they are independent, and a deck
  // with many cross-origin images would otherwise pay one round-trip
  // of latency per image.
  const entries = await Promise.all(
    Array.from(originals).map(async (src) => {
      if (src.startsWith('data:') || src.startsWith('blob:')) {
        return { src, url: src, temp: false };
      }
      if (!fetcher) {
        // No fetcher: best-effort. Same-origin srcs render fine; a
        // cross-origin one would taint, but that is the caller's contract.
        return { src, url: src, temp: false };
      }
      try {
        const blob = await fetcher(src);
        return { src, url: URL.createObjectURL(blob), temp: true };
      } catch {
        return { src, url: BLANK_PNG, temp: false };
      }
    }),
  );

  const map = new Map<string, string>();
  const temp: string[] = [];
  for (const entry of entries) {
    map.set(entry.src, entry.url);
    if (entry.temp) temp.push(entry.url);
  }
  return { map, temp };
}

/**
 * Deep-clone a slide into the form the exporter should rasterise:
 *   - every image src rewritten to its taint-free URL;
 *   - the deck master's background image (used when the slide has none
 *     of its own) resolved onto the clone so `drawSlide` never reaches
 *     the original cross-origin master src;
 *   - `placeholderRef` stripped from every element so empty placeholders
 *     do NOT paint their editor-only "Click to add title" ghost hint
 *     into the PDF. The hint is the sole render-path consumer of
 *     `placeholderRef` (element-renderer's `text` case), and real
 *     placeholder text bakes its typography into the blocks, so dropping
 *     the ref only suppresses the hint.
 */
function prepareExportSlide(
  slide: Slide,
  doc: SlidesDocument,
  map: Map<string, string>,
): Slide {
  const cloned = structuredClone(slide) as Slide;
  for (const el of flattenElements(cloned.elements)) {
    delete el.placeholderRef;
    if (el.type === 'image' && el.data.src) {
      el.data.src = map.get(el.data.src) ?? el.data.src;
    }
  }
  if (cloned.background.image) {
    cloned.background.image.src =
      map.get(cloned.background.image.src) ?? cloned.background.image.src;
  } else {
    // Bake the inherited (layout → master) background image onto the
    // cloned slide so the offscreen raster sees it directly.
    const inheritedBg = resolveBackgroundImage(slide, doc);
    if (inheritedBg) {
      const clonedBg = structuredClone(inheritedBg) as BackgroundImage;
      clonedBg.src = map.get(inheritedBg.src) ?? inheritedBg.src;
      cloned.background.image = clonedBg;
    }
  }
  return cloned;
}

/** Image srcs to preload before painting a (cleaned) slide. */
function imageSrcsToPreload(slide: Slide): string[] {
  const srcs: string[] = [];
  for (const el of flattenElements(slide.elements)) {
    if (el.type === 'image' && el.data.src) srcs.push(el.data.src);
  }
  if (slide.background.image?.src) srcs.push(slide.background.image.src);
  return srcs;
}

/**
 * Resolve once `src` is loaded (or failed, or the timeout elapses).
 * Wraps the event-driven shared image cache in a promise so the single
 * paint can run after all assets settle.
 */
function awaitImageLoaded(src: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    const img = getOrLoadImage(src, finish);
    if (img !== null || isImageFailed(src)) {
      finish();
      return;
    }
    if (timeoutMs > 0) setTimeout(finish, timeoutMs);
  });
}

function createExportCanvas(width: number, height: number): ExportCanvas {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function canvasToBytes(
  canvas: ExportCanvas,
  format: 'png' | 'jpeg',
  quality: number,
): Promise<Uint8Array> {
  const type = format === 'jpeg' ? 'image/jpeg' : 'image/png';
  let blob: Blob;
  if (typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas) {
    blob = await canvas.convertToBlob({ type, quality });
  } else {
    blob = await new Promise<Blob>((resolve, reject) => {
      (canvas as HTMLCanvasElement).toBlob(
        (b) => (b ? resolve(b) : reject(new Error('canvas.toBlob returned null'))),
        type,
        quality,
      );
    });
  }
  return new Uint8Array(await blob.arrayBuffer());
}
