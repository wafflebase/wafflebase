/**
 * Turning a rectangle on screen into pixels.
 *
 * Two things live here: the geometry that decides which canvases contribute to
 * a capture and how each one maps into the output, and a thin painter that
 * issues those draws. The split is deliberate — the geometry is where the bugs
 * are, and it is testable without a rendering context, while the painter is
 * four lines of `drawImage` that only a real browser can exercise.
 *
 * WHY INTERSECTION AND NOT CONTAINMENT. The first version asked which canvases
 * contained the region's CENTRE, which passes on the sheet surface because its
 * grid and overlay canvases really do share one box. Measured on
 * `/harness/docs`, which mounts twelve canvases stacked VERTICALLY (six editors
 * × grid + overlay), a 220×120 region whose centre sat in the first pair with
 * its lower third over the next composited two layers and produced an image
 * whose bottom third was BLACK. Someone crossing a page seam to report the seam
 * would have attached evidence with the seam missing. See
 * `docs/design/debug-report.md`, measured finding 6.
 */

import { rectsIntersect, type Rect } from '@wafflebase/core/geometry';

/** Longest side of a stored capture, in output pixels. */
export const MAX_CAPTURE_SIDE = 1280;

/** Default encoding. JPEG because these are screenshots of anti-aliased text. */
export const CAPTURE_MIME = 'image/jpeg';
export const CAPTURE_QUALITY = 0.8;

/** A canvas and where it sits, in client CSS pixels. */
export type CanvasLayer = {
  /** The backing store's own size, which is DPR-scaled relative to `box`. */
  backing: { w: number; h: number };
  box: Rect;
  /**
   * Where this layer sits in the PAINT order — its effective `z-index`, with
   * `auto` counting as 0.
   *
   * DOM order is not paint order, and on the primary target surface the two
   * disagree: `packages/sheets/src/view/worksheet.ts` appends the OVERLAY
   * canvas before the grid canvas, and `overlay.ts` gives it `z-index: 1`, so
   * the overlay is earlier in the document and painted on top. Compositing in
   * document order therefore drew the opaque grid over the overlay and lost the
   * selection rectangle, the active-cell border and the peer cursors — exactly
   * the content finding 2 exists to preserve.
   */
  z?: number;
};

/**
 * One layer's contribution: a crop in that layer's BACKING pixels, painted into
 * a destination in OUTPUT pixels.
 */
export type DrawOp = {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
};

const isPositiveSize = (r: { w: number; h: number }): boolean =>
  Number.isFinite(r.w) && Number.isFinite(r.h) && r.w > 0 && r.h > 0;

/** Whether two rectangles share AREA, not merely an edge. */
function overlaps(a: Rect, b: Rect): boolean {
  // `rectsIntersect` counts bare edge contact, which would admit a layer that
  // paints nothing — and a contributor that paints nothing still raises
  // `pixelRatioOf`, inflating the output size for no pixels.
  return (
    rectsIntersect(a, b) &&
    Math.min(a.x + a.w, b.x + b.w) > Math.max(a.x, b.x) &&
    Math.min(a.y + a.h, b.y + b.h) > Math.max(a.y, b.y)
  );
}

/**
 * The layers that actually contribute to `rect`, in PAINT order — lowest first,
 * so a later `drawImage` lands on top exactly as the browser composited it.
 *
 * The sort is stable within one `z`, so canvases that share a stacking level
 * keep their document order, which is what decides the outcome there.
 */
export function layersForRect<T extends CanvasLayer>(
  layers: readonly T[],
  rect: Rect,
): T[] {
  if (!isPositiveSize(rect)) return [];
  return layers
    .map((layer, index) => ({ layer, index }))
    .filter(
      ({ layer }) =>
        isPositiveSize(layer.box) &&
        isPositiveSize(layer.backing) &&
        overlaps(layer.box, rect),
    )
    .sort((a, b) => (a.layer.z ?? 0) - (b.layer.z ?? 0) || a.index - b.index)
    .map(({ layer }) => layer);
}

/**
 * The pixel ratio to capture at: the highest any contributing layer offers.
 *
 * Taking the highest rather than `window.devicePixelRatio` keeps the capture as
 * sharp as the sharpest source and needs no global — and the two can disagree,
 * because an engine is free to size its backing store however it likes.
 */
export function pixelRatioOf(layers: readonly CanvasLayer[]): number {
  let ratio = 1;
  for (const layer of layers) {
    if (!isPositiveSize(layer.box) || !isPositiveSize(layer.backing)) continue;
    ratio = Math.max(
      ratio,
      layer.backing.w / layer.box.w,
      layer.backing.h / layer.box.h,
    );
  }
  return ratio;
}

/** Output size for `rect`, honouring the pixel ratio and the side cap. */
export function outputSizeFor(
  rect: Rect,
  pixelRatio: number,
): { w: number; h: number } {
  const w = rect.w * pixelRatio;
  const h = rect.h * pixelRatio;
  const scale = Math.min(1, MAX_CAPTURE_SIDE / Math.max(w, h));
  return {
    w: Math.max(1, Math.round(w * scale)),
    h: Math.max(1, Math.round(h * scale)),
  };
}

/**
 * How one layer maps into the output, or `undefined` when it does not overlap.
 *
 * The source crop is the INTERSECTION of the region and the layer, never the
 * whole region: a layer that covers half the region must paint half the output
 * and leave the rest to whoever covers it. Cropping to the layer instead of the
 * region is exactly what the black band came from.
 */
export function drawOpFor(
  layer: CanvasLayer,
  rect: Rect,
  output: { w: number; h: number },
): DrawOp | undefined {
  if (!isPositiveSize(rect) || !isPositiveSize(layer.box)) return undefined;
  if (!isPositiveSize(layer.backing)) return undefined;

  const left = Math.max(rect.x, layer.box.x);
  const top = Math.max(rect.y, layer.box.y);
  const right = Math.min(rect.x + rect.w, layer.box.x + layer.box.w);
  const bottom = Math.min(rect.y + rect.h, layer.box.y + layer.box.h);
  if (right <= left || bottom <= top) return undefined;

  // Backing pixels per CSS pixel, per axis. Kept per-axis rather than assuming
  // a square ratio, because a canvas whose CSS box is stretched has two.
  const bx = layer.backing.w / layer.box.w;
  const by = layer.backing.h / layer.box.h;
  const ox = output.w / rect.w;
  const oy = output.h / rect.h;

  return {
    sx: (left - layer.box.x) * bx,
    sy: (top - layer.box.y) * by,
    sw: (right - left) * bx,
    sh: (bottom - top) * by,
    dx: (left - rect.x) * ox,
    dy: (top - rect.y) * oy,
    dw: (right - left) * ox,
    dh: (bottom - top) * oy,
  };
}

/** Everything a capture needs to know about the page it is capturing. */
export type CaptureSource<T extends CanvasLayer = CanvasLayer> = {
  layers: readonly T[];
  /** The image source for a layer. Separate from geometry so tests need no DOM. */
  imageFor: (layer: T) => CanvasImageSource;
};

export type CaptureResult = {
  dataUrl: string;
  w: number;
  h: number;
  layers: number;
  mime: string;
  /**
   * The share of the output any canvas actually painted, 0-1.
   *
   * Below 1 the region reached past the canvases under it. The uncovered part is
   * filled rather than left transparent — JPEG has no alpha, so a fresh canvas's
   * `rgba(0,0,0,0)` encodes as a solid BLACK block, which is indistinguishable
   * from lost data and is the same symptom finding 6 was about. Filling makes it
   * look like what it is (nothing there), and reporting the number lets the
   * panel say so rather than leaving the reporter to wonder.
   */
  coverage: number;
};

export type CaptureOptions = {
  mime?: string;
  quality?: number;
  /**
   * What the parts of the region no canvas covers are filled with. A flat
   * colour, because the alternative encodes as black — see `coverage`.
   */
  background?: string;
  /** Injected so a test can supply a recording stub instead of a real canvas. */
  createCanvas?: (w: number, h: number) => CaptureTarget | undefined;
};

/** Neutral, and visibly not content. */
export const CAPTURE_BACKGROUND = '#f5f5f5';

/** The output surface. Narrower than `HTMLCanvasElement` on purpose. */
export type CaptureTarget = {
  width: number;
  height: number;
  fill: (color: string) => void;
  drawImage: (image: CanvasImageSource, op: DrawOp) => void;
  toDataUrl: (mime: string, quality: number) => string;
};

function domCaptureTarget(w: number, h: number): CaptureTarget | undefined {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;
  return {
    width: w,
    height: h,
    fill: (color) => {
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, w, h);
    },
    drawImage: (image, op) => {
      ctx.drawImage(
        image,
        op.sx,
        op.sy,
        op.sw,
        op.sh,
        op.dx,
        op.dy,
        op.dw,
        op.dh,
      );
    },
    toDataUrl: (mime, quality) => canvas.toDataURL(mime, quality),
  };
}

/**
 * Composite the layers under `rect` into one image.
 *
 * Returns `undefined` rather than a blank image when nothing contributes: an
 * empty capture is indistinguishable from a broken one, and the caller has a
 * better answer for a region over pure DOM (describe the elements instead).
 */
export function captureRegion<T extends CanvasLayer>(
  rect: Rect,
  source: CaptureSource<T>,
  options: CaptureOptions = {},
): CaptureResult | undefined {
  const contributing = layersForRect(source.layers, rect);
  if (contributing.length === 0) return undefined;

  const output = outputSizeFor(rect, pixelRatioOf(contributing));
  const target = (options.createCanvas ?? domCaptureTarget)(
    output.w,
    output.h,
  );
  if (!target) return undefined;

  target.fill(options.background ?? CAPTURE_BACKGROUND);

  let painted = 0;
  const ops: DrawOp[] = [];
  for (const layer of contributing) {
    const op = drawOpFor(layer, rect, output);
    if (!op) continue;
    target.drawImage(source.imageFor(layer), op);
    ops.push(op);
    painted += 1;
  }
  if (painted === 0) return undefined;

  const mime = options.mime ?? CAPTURE_MIME;
  try {
    return {
      dataUrl: target.toDataUrl(mime, options.quality ?? CAPTURE_QUALITY),
      w: output.w,
      h: output.h,
      layers: painted,
      mime,
      coverage: coverageOf(ops, output),
    };
  } catch {
    // A tainted canvas throws here. Same-origin renders never do, so this
    // firing in practice is a finding about the app, not about this code.
    return undefined;
  }
}

/**
 * How much of the output at least one layer painted, 0-1.
 *
 * Union area, not the sum: stacked canvases share a box, and counting them twice
 * would report 200 % coverage on the surface this feature exists for. Computed
 * by scanning rows of destination rectangles, which is exact for the handful of
 * axis-aligned layers involved.
 */
export function coverageOf(
  ops: readonly DrawOp[],
  output: { w: number; h: number },
): number {
  const area = output.w * output.h;
  if (area <= 0 || ops.length === 0) return 0;

  const edges = Array.from(
    new Set(ops.flatMap((op) => [op.dy, op.dy + op.dh])),
  ).sort((a, b) => a - b);

  let covered = 0;
  for (let i = 0; i + 1 < edges.length; i += 1) {
    const top = edges[i];
    const bottom = edges[i + 1];
    const height = bottom - top;
    if (height <= 0) continue;
    const spans = ops
      .filter((op) => op.dy <= top && op.dy + op.dh >= bottom)
      .map((op) => [op.dx, op.dx + op.dw] as const)
      .sort((a, b) => a[0] - b[0]);
    let width = 0;
    let reach = -Infinity;
    for (const [start, end] of spans) {
      const from = Math.max(start, reach);
      if (end > from) {
        width += end - from;
        reach = end;
      }
    }
    covered += width * height;
  }
  return Math.min(1, covered / area);
}

/**
 * The canvases on the page, as capture layers.
 *
 * Queried from the DOM rather than hit-tested. Measured on the sheet surface:
 * both canvases compute to `pointer-events: none` with the events handled by
 * their wrapper `div`, so `document.elementsFromPoint()` at the grid centre
 * returned four divs and ZERO canvases — a hit-test locator would capture
 * nothing on exactly the surfaces this feature exists for
 * (`docs/design/debug-report.md`, measured finding 1).
 */
export function canvasLayers(
  root: ParentNode = document,
): Array<CanvasLayer & { canvas: HTMLCanvasElement }> {
  return Array.from(root.querySelectorAll('canvas'), (canvas) => {
    const r = canvas.getBoundingClientRect();
    return {
      canvas,
      backing: { w: canvas.width, h: canvas.height },
      box: { x: r.left, y: r.top, w: r.width, h: r.height },
      z: stackingLevel(canvas),
    };
  });
}

/**
 * A canvas's effective stacking level.
 *
 * `auto` is 0. Read from the computed style rather than the inline one, because
 * the sheet sets it in a stylesheet-shaped way and the value that matters is the
 * one the browser used to composite.
 */
function stackingLevel(el: Element): number {
  const raw =
    typeof getComputedStyle === 'function' ? getComputedStyle(el).zIndex : 'auto';
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Capture whatever canvases lie under `rect` on the live page. */
export function captureRegionFromDom(
  rect: Rect,
  options: CaptureOptions & { root?: ParentNode } = {},
): CaptureResult | undefined {
  const layers = canvasLayers(options.root ?? document);
  return captureRegion(
    rect,
    { layers, imageFor: (layer) => layer.canvas },
    options,
  );
}
