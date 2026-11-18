/**
 * Region export — rasterise a world-space rectangle of ONE slide's plane
 * to PNG, or wrap that raster in a single-page PDF sized to it.
 *
 * The board (`@wafflebase/board`, an unbounded "slide") uses this for
 * "Download as PNG / PDF": the same `drawSlide()` painter the editor,
 * minimap and slide PDF export use, driven through the board-mode
 * `viewport` transform instead of the fixed slide fit. Image handling is
 * the slide PDF exporter's (`./pdf`): cross-origin srcs are fetched into
 * taint-free object URLs first, so `toBlob` does not throw.
 *
 * Browser-only, like `./pdf`.
 */
import type { Slide, SlidesDocument } from '../model/presentation';
import {
  drawSlide,
  type SlideRendererOptions,
} from '../view/canvas/slide-renderer';
import { evictImageSrcs } from '../view/canvas/image-cache';
import {
  awaitImageLoaded,
  canvasToBytes,
  createExportCanvas,
  imageSrcsToPreload,
  prepareExportSlide,
  resolveDeckImages,
  type SlidesImageFetcher,
} from './pdf';

/** A rectangle in the slide's world (logical) px. */
export interface WorldRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Longest bitmap side we ask a browser for. Chrome and Firefox refuse a
 * canvas side past 32k; 16k leaves headroom and is still far past any
 * screen.
 */
export const REGION_MAX_SIDE = 16384;

/**
 * Largest bitmap area: Safari's canvas limit (4096 × 4096). Past it Safari
 * hands back a canvas that silently draws nothing, so a huge board is
 * downscaled rather than exported blank.
 */
export const REGION_MAX_AREA = 16_777_216;

/** The largest PDF page side pdf readers accept (200 in at 72 pt/in). */
const PDF_MAX_PAGE_PT = 14400;

/** CSS px → PDF pt (96 dpi → 72 pt/in). */
const PT_PER_PX = 0.75;

export interface RasterizeRegionOptions {
  /** Supersampling factor, world px → bitmap px. Default `2`. */
  scale?: number;
  /** Override {@link REGION_MAX_SIDE}. */
  maxSide?: number;
  /** Override {@link REGION_MAX_AREA}. */
  maxArea?: number;
  /** Fill painted under the content (CSS colour). Omit for transparent. */
  background?: string;
  /** Only paint these top-level elements (an exported selection). */
  elementIds?: readonly string[];
  /** Fetch http(s) image bytes with credentials to avoid canvas tainting. */
  imageFetcher?: SlidesImageFetcher;
  /** Per-image load timeout in ms. Default `15000`. */
  assetTimeoutMs?: number;
  /**
   * Host paint pass run after every element, in world coordinates — the
   * same hook the editor canvas takes (`SlideRendererOptions`), so an
   * export paints what the screen does (the board's section titles and
   * hidden-section covers). Receives the scoped slide. Omit for none.
   */
  paintAfterElements?: SlideRendererOptions['paintAfterElements'];
}

export interface RasterizedRegion {
  /** PNG bytes. */
  bytes: Uint8Array;
  width: number;
  height: number;
  /** The scale actually used: below the requested one when capped. */
  scale: number;
}

/**
 * The bitmap size for `region` at `scale`, shrinking the scale (never the
 * region) until both {@link REGION_MAX_SIDE} and {@link REGION_MAX_AREA}
 * hold. Pure.
 */
export function regionRasterSize(
  region: Pick<WorldRegion, 'w' | 'h'>,
  scale: number,
  maxSide: number = REGION_MAX_SIDE,
  maxArea: number = REGION_MAX_AREA,
): { width: number; height: number; scale: number } {
  const w = Math.max(1, region.w);
  const h = Math.max(1, region.h);
  let s = scale;
  s = Math.min(s, maxSide / w, maxSide / h);
  s = Math.min(s, Math.sqrt(maxArea / (w * h)));
  const width = Math.max(1, Math.floor(w * s));
  const height = Math.max(1, Math.floor(h * s));
  return { width, height, scale: s };
}

/**
 * PDF page size in pt for a raster of `region`: 1 world px = 0.75 pt (so
 * the page measures what the board measures on a 96-dpi screen), shrunk
 * uniformly when a side would pass the PDF page limit. Pure.
 */
export function regionPageSize(
  region: Pick<WorldRegion, 'w' | 'h'>,
): { width: number; height: number } {
  let width = Math.max(1, region.w) * PT_PER_PX;
  let height = Math.max(1, region.h) * PT_PER_PX;
  const over = Math.max(width, height) / PDF_MAX_PAGE_PT;
  if (over > 1) {
    width /= over;
    height /= over;
  }
  return { width, height };
}

/**
 * Paint `region` of `slide` into a PNG.
 */
export async function rasterizeSlideRegion(
  doc: SlidesDocument,
  slide: Slide,
  region: WorldRegion,
  opts: RasterizeRegionOptions = {},
): Promise<RasterizedRegion> {
  const size = regionRasterSize(
    region,
    opts.scale ?? 2,
    opts.maxSide,
    opts.maxArea,
  );
  const ids = opts.elementIds ? new Set(opts.elementIds) : null;
  const scoped: Slide = ids
    ? { ...slide, elements: slide.elements.filter((e) => ids.has(e.id)) }
    : slide;
  const scopedDoc: SlidesDocument = { ...doc, slides: [scoped] };

  if (typeof document !== 'undefined' && document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      /* font readiness is best-effort */
    }
  }

  const { map, temp } = await resolveDeckImages(scopedDoc, opts.imageFetcher);
  try {
    const cloned = prepareExportSlide(scoped, scopedDoc, map);
    const timeout = opts.assetTimeoutMs ?? 15000;
    await Promise.all(
      imageSrcsToPreload(cloned).map((s) => awaitImageLoaded(s, timeout)),
    );

    const canvas = createExportCanvas(size.width, size.height);
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null;
    if (!ctx) throw new Error('Failed to acquire a 2D context for export.');
    drawSlide(ctx, cloned, scopedDoc, {
      hostWidth: size.width,
      hostHeight: size.height,
      dpr: 1,
      viewport: {
        zoom: size.scale,
        panX: -region.x * size.scale,
        panY: -region.y * size.scale,
      },
      paintAfterElements: opts.paintAfterElements,
    });
    if (opts.background) {
      // `drawSlide` clears the bitmap in board mode, so the plane colour
      // goes in underneath afterwards.
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = opts.background;
      ctx.fillRect(0, 0, size.width, size.height);
      ctx.globalCompositeOperation = 'source-over';
    }
    const bytes = await canvasToBytes(canvas, 'png', 1);
    return { bytes, width: size.width, height: size.height, scale: size.scale };
  } finally {
    if (temp.length > 0) {
      evictImageSrcs(temp);
      for (const url of temp) URL.revokeObjectURL(url);
    }
  }
}

/**
 * `region` of `slide` as a one-page PDF sized to the region (see
 * {@link regionPageSize}), the page a raster of it.
 */
export async function exportSlideRegionPdf(
  doc: SlidesDocument,
  slide: Slide,
  region: WorldRegion,
  opts: RasterizeRegionOptions & { title?: string } = {},
): Promise<Uint8Array> {
  const raster = await rasterizeSlideRegion(doc, slide, region, opts);
  // Dynamic, as in `./pdf`: pdf-lib loads only when someone exports.
  const { PDFDocument } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  if (opts.title) pdf.setTitle(opts.title);
  const image = await pdf.embedPng(raster.bytes);
  const page = regionPageSize(region);
  pdf
    .addPage([page.width, page.height])
    .drawImage(image, { x: 0, y: 0, width: page.width, height: page.height });
  return pdf.save();
}
