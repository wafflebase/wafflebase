import {
  CanvasTextMeasurer,
  computeLayout,
  normalizeBlockStyle,
  paintLayout,
  type Block,
} from '@wafflebase/docs';
import type { TextElement } from '../../model/element';
import type { Theme } from '../../model/theme';
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
 * math, same font-size handling, same list-marker glyphs.
 *
 * Block styles are normalised before layout because slides may persist
 * blocks with sparse `style: {}` (e.g. via `buildInsertElement`) and
 * `computeLayout` does `y += block.style.marginTop` without a fallback
 * — `undefined` would NaN-out the cumulative y and the text would paint
 * at the top edge of the frame instead of where the editor (which
 * normalises through `MemDocStore.setDocument` on mount) drew it.
 *
 * `theme` is accepted for forward compatibility but NOT yet plumbed
 * into `computeLayout` / `paintLayout`. Task 4 extends `@wafflebase/docs`
 * with a `colorResolver` option so role-bound text colors can resolve
 * through the deck's theme; for now the text path stays on docs'
 * default color handling.
 */
export function drawText(
  ctx: CanvasRenderingContext2D,
  { w }: FrameSize,
  data: TextElement['data'],
  theme: Theme,
): void {
  void theme; // Task 4 wires the colorResolver; signature kept stable.
  if (data.blocks.length === 0) return;
  const normalized: Block[] = data.blocks.map((b) => ({
    ...b,
    style: normalizeBlockStyle(b.style),
  }));
  const { layout } = computeLayout(normalized, measurer, w);
  paintLayout(ctx, layout, 0, 0);
}
