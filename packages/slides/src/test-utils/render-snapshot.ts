import { createCanvas } from 'canvas';
import type { Slide, SlidesDocument } from '../model/presentation';
import { drawSlide } from '../view/canvas/slide-renderer';

/**
 * Snapshot dimensions for visual-test goldens. Small (320x180) so PNG
 * byte size stays manageable in source control while still exercising
 * the scale path from logical 1920x1080 down to host pixels.
 */
const SNAPSHOT_W = 320;
const SNAPSHOT_H = 180;

/**
 * Render a single slide into a node-canvas-backed PNG buffer. Used by
 * visual-test goldens to byte-compare renderer output across themes.
 *
 * `drawSlide` owns the world->host transform itself (see
 * `slide-renderer.ts`): it `setTransform(1,...)`-resets, clears, then
 * scales by `hostWidth/SLIDE_WIDTH * dpr`. So we pass `hostWidth/Height`
 * as the snapshot dimensions and don't pre-scale here.
 */
export function renderSlideToPng(
  slide: Slide,
  doc: SlidesDocument,
): Buffer {
  const canvas = createCanvas(SNAPSHOT_W, SNAPSHOT_H);
  const ctx = canvas.getContext('2d');
  drawSlide(
    ctx as unknown as CanvasRenderingContext2D,
    slide,
    doc,
    { hostWidth: SNAPSHOT_W, hostHeight: SNAPSHOT_H, dpr: 1 },
  );
  return canvas.toBuffer('image/png');
}

/**
 * Render every slide in `doc` as a horizontal strip — slide 0 leftmost,
 * slide N rightmost. Each panel is rendered to its own canvas (so
 * `drawSlide`'s internal `setTransform(1,...)` reset doesn't clobber
 * the strip transform) then composited onto the strip via `drawImage`.
 *
 * Empty decks render a single blank panel so the golden file is always
 * > 0 bytes (PNG diff sensitive to background fill, so even a "no
 * slides" deck still proves the theme background color resolves
 * correctly).
 */
export function renderDeckThumbStrip(
  doc: SlidesDocument,
): Buffer {
  const slides: Slide[] =
    doc.slides.length > 0
      ? doc.slides
      : [
          {
            id: '__empty__',
            layoutId: 'blank',
            background: { fill: { kind: 'role', role: 'background' } },
            elements: [],
            notes: [],
          },
        ];
  const W = SNAPSHOT_W * slides.length;
  const stripCanvas = createCanvas(W, SNAPSHOT_H);
  const stripCtx = stripCanvas.getContext('2d');
  slides.forEach((slide, i) => {
    const panel = createCanvas(SNAPSHOT_W, SNAPSHOT_H);
    const panelCtx = panel.getContext('2d');
    drawSlide(
      panelCtx as unknown as CanvasRenderingContext2D,
      slide,
      doc,
      { hostWidth: SNAPSHOT_W, hostHeight: SNAPSHOT_H, dpr: 1 },
    );
    stripCtx.drawImage(panel as never, SNAPSHOT_W * i, 0);
  });
  return stripCanvas.toBuffer('image/png');
}
