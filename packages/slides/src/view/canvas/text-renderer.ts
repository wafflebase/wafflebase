import { CanvasTextMeasurer, computeLayout } from '@wafflebase/docs';
import type { TextElement } from '../../model/element';
import type { FrameSize } from './shape-renderer';
import { resolveSlideFontFamily } from './fonts';

/**
 * Module-scope measurer reused across every text-element render. Owning
 * one shared instance is essential for the per-measurer width cache
 * that `computeLayout` relies on — a fresh measurer per call would
 * thrash the cache.
 */
const measurer = new CanvasTextMeasurer();

/**
 * Draw a text element into element-local coordinates (top-left at 0,0).
 * The frame transform belongs to the element-renderer in T5; this
 * function only knows about (w, h) and the rich-text blocks.
 *
 * Layout is delegated to `@wafflebase/docs/computeLayout`, which is the
 * same engine the docs editor uses, so font/size/alignment/lists/inline
 * styles all behave identically inside a slide text box and inside a
 * standalone document.
 */
export function drawText(
  ctx: CanvasRenderingContext2D,
  { w }: FrameSize,
  data: TextElement['data'],
): void {
  if (data.blocks.length === 0) return;
  const { layout } = computeLayout(data.blocks, measurer, w);
  for (const block of layout.blocks) {
    for (const line of block.lines) {
      const baseY = block.y + line.y + line.height; // baseline ~ bottom of line box
      for (const run of line.runs) {
        // Skip image runs — slides text boxes don't contain inline
        // images in v1 (image elements are top-level), and the layout
        // engine signals image runs by setting `imageHeight`.
        if (run.imageHeight !== undefined) continue;
        const font = resolveCtxFont(run.inline.style);
        if (font !== undefined) ctx.font = font;
        ctx.fillStyle = run.inline.style.color ?? '#000';
        ctx.fillText(run.text, block.x + run.x, baseY);
      }
    }
  }
}

/**
 * Build the Canvas 2D `font` shorthand from an inline style. Returns
 * undefined if the style contributes nothing (caller can skip the ctx
 * mutation). Shape mirrors `fontToCss` in docs' canvas-measurer so
 * paint and measurement use the same string.
 */
function resolveCtxFont(style: {
  fontSize?: number;
  fontFamily?: string;
  bold?: boolean;
  italic?: boolean;
}): string | undefined {
  const size = style.fontSize ?? 11; // pt; converted to px below
  // Route through the docs font registry so Korean / CJK font names
  // (e.g. `'맑은 고딕'`) resolve to a CSS chain that includes
  // `'Noto Sans KR'` as an explicit fallback. See `./fonts.ts`.
  const family = resolveSlideFontFamily(style.fontFamily);
  const px = size * (96 / 72); // pt → px (matches docs ptToPx)
  const weight = style.bold ? 'bold ' : '';
  const italic = style.italic ? 'italic ' : '';
  return `${italic}${weight}${px}px ${family}`;
}
