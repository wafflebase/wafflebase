/**
 * `overlap` — foreground content colliding with other content.
 *
 * A pair is reported when the intersection covers at least
 * `overlapMinFraction` (default 15%) of the smaller element's area and at
 * least one of the two carries text. Excluded as intentional layering:
 * backgrounds (text-less shapes/images covering ≥ 80% of the slide), thin
 * decorative rules and bars (≤ 24 px), and a text-less shape that fully
 * encloses the other element (cards, panels, chips). Elements that paint
 * nothing (an empty, unfilled text box) are ignored. Text beside an image
 * counts only when it sits on the picture (see `imageCoversText`). Two text-less elements
 * overlapping (a photo collage, stacked decoration) is not reported.
 */
import type { Element } from '../../model/element';
import type { Slide } from '../../model/presentation';
import {
  encloses,
  fmt,
  hasText,
  intersection,
  paintedBox,
  paintsNothing,
  type Box,
  type DeckContext,
  type PlacedElement,
} from '../context';
import type { Finding } from '../types';

const BACKGROUND_COVERAGE = 0.8;
const DECORATIVE_MAX_THICKNESS = 24;

function isBackground(el: Element, box: Box, ctx: DeckContext): boolean {
  if (el.type !== 'shape' && el.type !== 'image') return false;
  if (hasText(el)) return false;
  if ((box.w * box.h) / (ctx.slideW * ctx.slideH) >= BACKGROUND_COVERAGE) return true;
  return el.type === 'shape' && Math.min(box.w, box.h) <= DECORATIVE_MAX_THICKNESS;
}

/**
 * An image's frame includes its transparent padding, which we cannot see:
 * a caption set just under an icon or an arrow graphic intersects the
 * frame without touching a pixel. So text and an image only count as
 * overlapping when the text's center lies well inside the image (its frame
 * inset by 10% per side) — text placed on the picture, not beside it.
 */
function imageCoversText(image: Box, text: Box): boolean {
  const cx = text.x + text.w / 2;
  const cy = text.y + text.h / 2;
  return (
    cx > image.x + image.w * 0.1 &&
    cx < image.x + image.w * 0.9 &&
    cy > image.y + image.h * 0.1 &&
    cy < image.y + image.h * 0.9
  );
}

export function checkOverlap(
  slide: Slide,
  slideIndex: number,
  placed: PlacedElement[],
  ctx: DeckContext,
): Finding[] {
  const items = placed
    .filter(
      (p) =>
        p.el.type !== 'group' &&
        !paintsNothing(p.el) &&
        !isBackground(p.el, p.box, ctx),
    )
    .map((p) => ({ ...p, box: paintedBox(p, ctx) }));
  const findings: Finding[] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      if (!hasText(a.el) && !hasText(b.el)) continue;
      const inter = intersection(a.box, b.box);
      if (!inter) continue;
      const smaller = Math.min(a.box.w * a.box.h, b.box.w * b.box.h);
      const fraction = smaller > 0 ? (inter.w * inter.h) / smaller : 0;
      if (fraction < ctx.opts.overlapMinFraction) continue;
      const img = a.el.type === 'image' ? a : b.el.type === 'image' ? b : undefined;
      if (img && !imageCoversText(img.box, img === a ? b.box : a.box)) continue;
      const aContainer = !hasText(a.el) && a.el.type === 'shape' && encloses(a.box, b.box);
      const bContainer = !hasText(b.el) && b.el.type === 'shape' && encloses(b.box, a.box);
      if (aContainer || bContainer) continue;
      findings.push({
        rule: 'overlap',
        severity: 'warning',
        slideId: slide.id,
        slideIndex,
        elementId: b.el.id,
        message: `overlaps ${a.el.id} by ${Math.round(fraction * 100)}% of the smaller element (${fmt(inter.w)}x${fmt(inter.h)}px)`,
      });
    }
  }
  return findings;
}
