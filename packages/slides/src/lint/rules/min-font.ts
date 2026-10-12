/**
 * `min-font` — text too small to read when presented.
 *
 * Sizes are slide points (`slidePtFromStoredPt`): the rendered size
 * normalized to the 13.333-inch widescreen slide, after the deck's
 * PPTX-import pre-scale and shrink-autofit — so a PPTX deck and an in-app
 * deck are judged on what a viewer sees, not on the number in the toolbar.
 * Footer-like text is held to the smaller footer minimum.
 */
import type { Slide } from '../../model/presentation';
import {
  fmt,
  hasText,
  isFooterLike,
  layoutText,
  textRuns,
  type DeckContext,
  type PlacedElement,
} from '../context';
import type { Finding } from '../types';

export function checkMinFont(
  slide: Slide,
  slideIndex: number,
  placed: PlacedElement[],
  ctx: DeckContext,
): Finding[] {
  const findings: Finding[] = [];
  for (const p of placed) {
    if (!hasText(p.el)) continue;
    const tl = layoutText(p.el, ctx);
    if (!tl) continue;
    const min = isFooterLike(p, ctx) ? ctx.opts.minFooterFontPt : ctx.opts.minFontPt;
    const smallest = Math.min(...textRuns(tl).map((r) => r.pt));
    if (!Number.isFinite(smallest) || smallest >= min) continue;
    findings.push({
      rule: 'min-font',
      severity: smallest < min * 0.75 ? 'error' : 'warning',
      slideId: slide.id,
      slideIndex,
      elementId: p.el.id,
      message:
        `smallest text renders at ${fmt(smallest)}pt (min ${min}pt)` +
        (tl.shrinkScale < 1 ? ` after shrink-autofit to ${Math.round(tl.shrinkScale * 100)}%` : ''),
    });
  }
  return findings;
}
