/**
 * `out-of-bounds` — content that extends past the slide edge, where it is
 * cut off when presented or exported.
 *
 * Text, tables and charts are checked strictly — text by its painted lines,
 * so a wide frame around centered text may hang off the slide, while text
 * that grows past the bottom edge is caught. Text-less shapes and images
 * bleed off the edge on purpose often enough (full-bleed photos, corner
 * decorations) that only one lying entirely off the slide is reported —
 * and then as `info`, since it may be a parked asset.
 */
import type { Slide } from '../../model/presentation';
import {
  fmt,
  hasText,
  paintedBox,
  paintsNothing,
  type DeckContext,
  type PlacedElement,
} from '../context';
import type { Finding } from '../types';

export function checkOutOfBounds(
  slide: Slide,
  slideIndex: number,
  placed: PlacedElement[],
  ctx: DeckContext,
): Finding[] {
  const tol = ctx.opts.boundsTolerance;
  const findings: Finding[] = [];
  for (const p of placed) {
    const { el } = p;
    if (el.type === 'group' || paintsNothing(el)) continue;
    // Text by its ink: a frame that pokes past the edge around centered
    // text is harmless, text grown past the bottom of its frame is not.
    const box = paintedBox(p, ctx);
    const over = {
      left: -box.x,
      top: -box.y,
      right: box.x + box.w - ctx.slideW,
      bottom: box.y + box.h - ctx.slideH,
    };
    const offSlide =
      box.x >= ctx.slideW || box.y >= ctx.slideH || box.x + box.w <= 0 || box.y + box.h <= 0;
    const content = hasText(el) || el.type === 'table' || el.type === 'chart';

    if (!content) {
      if (offSlide) {
        findings.push({
          rule: 'out-of-bounds',
          severity: 'info',
          slideId: slide.id,
          slideIndex,
          elementId: el.id,
          message: `${el.type} lies entirely off the slide`,
        });
      }
      continue;
    }
    const sides = (Object.keys(over) as (keyof typeof over)[]).filter((s) => over[s] > tol);
    if (sides.length === 0) continue;
    findings.push({
      rule: 'out-of-bounds',
      severity: offSlide ? 'error' : 'warning',
      slideId: slide.id,
      slideIndex,
      elementId: el.id,
      message: offSlide
        ? `${el.type} with content lies entirely off the slide`
        : `${el.type} extends past the ${sides
            .map((s) => `${s} edge by ${fmt(over[s])}px`)
            .join(', ')}`,
    });
  }
  return findings;
}
