import { CanvasTextMeasurer, computeLayout, paintLayout } from '@wafflebase/docs';
import type { TextElement } from '../../model/element';
import type { FrameSize } from './shape-renderer';

/**
 * Module-scope measurer reused across every text-element render. Owning
 * one shared instance is essential for the per-measurer width cache
 * that `computeLayout` relies on — a fresh measurer per call would
 * thrash the cache.
 */
const measurer = new CanvasTextMeasurer();

/**
 * Draw a text element into element-local coordinates (top-left at 0,0).
 * The frame transform belongs to the element-renderer; this function
 * only knows about (w, h) and the rich-text blocks.
 *
 * Layout AND painting are delegated to `@wafflebase/docs` so that the
 * committed slide canvas and the in-place text-box editor (which also
 * calls `paintLayout`) produce pixel-identical output — same baseline
 * math, same font-size handling, same list-marker glyphs. Without this,
 * the two surfaces drift (the slide canvas would put the baseline at
 * the bottom of the line box while the editor centres it inside the
 * line box → committed text appears to "jump" vertically on blur).
 */
export function drawText(
  ctx: CanvasRenderingContext2D,
  { w }: FrameSize,
  data: TextElement['data'],
): void {
  if (data.blocks.length === 0) return;
  const { layout } = computeLayout(data.blocks, measurer, w);
  paintLayout(ctx, layout, 0, 0);
}
