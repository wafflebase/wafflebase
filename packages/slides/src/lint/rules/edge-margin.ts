/**
 * `edge-margin` — text painted closer to the slide edge than the safe
 * margin (default 0.5 in), where projectors crop and it reads as cramped.
 *
 * Measured on the painted text, not the frame: a full-width title box
 * whose centered text sits well inside the margin is fine. Footer-like
 * text (a short element in the bottom band: page numbers, sources) is
 * exempt. Text already past the edge is `out-of-bounds`' to report.
 */
import type { Slide } from '../../model/presentation';
import {
  hasText,
  inkBox,
  isFooterLike,
  layoutText,
  PX_PER_INCH,
  type DeckContext,
  type PlacedElement,
} from '../context';
import type { Finding } from '../types';

export function checkEdgeMargin(
  slide: Slide,
  slideIndex: number,
  placed: PlacedElement[],
  ctx: DeckContext,
): Finding[] {
  const margin = ctx.opts.edgeMarginInches * PX_PER_INCH;
  const findings: Finding[] = [];
  for (const p of placed) {
    if (!hasText(p.el) || isFooterLike(p, ctx)) continue;
    const ink = inkBox(p, layoutText(p.el, ctx));
    const gaps = {
      left: ink.x,
      top: ink.y,
      right: ctx.slideW - (ink.x + ink.w),
      bottom: ctx.slideH - (ink.y + ink.h),
    };
    const close = (Object.keys(gaps) as (keyof typeof gaps)[]).filter(
      (s) => gaps[s] >= 0 && gaps[s] < margin,
    );
    if (close.length === 0) continue;
    findings.push({
      rule: 'edge-margin',
      severity: 'info',
      slideId: slide.id,
      slideIndex,
      elementId: p.el.id,
      message: `text is ${close
        .map((s) => `${(gaps[s] / PX_PER_INCH).toFixed(2)}in from the ${s} edge`)
        .join(', ')} (min ${ctx.opts.edgeMarginInches}in)`,
    });
  }
  return findings;
}
