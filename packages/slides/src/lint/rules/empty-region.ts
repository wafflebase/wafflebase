/**
 * `empty-region` — a content slide whose content stops early, leaving a
 * large empty band at the bottom of the safe area: everything crammed into
 * the top half reads as unfinished.
 *
 * The safe area runs from the edge margin (0.5 in) at the top down to the
 * footer band (the bottom 0.9 in, where `isFooterLike` text lives).
 * Content is every element that paints something, measured by its painted
 * region (text by its ink, so a tall frame with one short line counts as
 * that line), excluding backgrounds and thin decoration (`isBackground`),
 * footer-like text, and text-less shapes at least 80% of the slide tall
 * (a full-height side panel is decoration, not content).
 *
 * Skipped as intentionally sparse: slides on a title, section or
 * main-point layout, and slides with fewer than three content elements
 * (a cover, a quote, a single big number). Only the band *below* the
 * content is measured: space above it (a bottom-anchored title over a
 * photo) and between blocks is a design choice far more often than a
 * mistake.
 *
 * `info` from `emptyRegionMinFraction` (45% of the safe height) — some
 * slides breathe on purpose, and a fill-in skeleton (the seed templates'
 * two-column "—" lists end at ~55–65%) is sparse by design; `warning`
 * from `emptyRegionWarnFraction` (70%) — with less than a third of the
 * usable height holding anything, the content is almost certainly
 * stacked at the top (a title and one short row).
 */
import type { Slide } from '../../model/presentation';
import {
  fmt,
  hasText,
  isBackground,
  isFooterLike,
  paintedBox,
  paintsNothing,
  PX_PER_INCH,
  type DeckContext,
  type PlacedElement,
} from '../context';
import type { Finding } from '../types';

/** Layouts meant to be sparse: covers, section breaks, a single statement. */
const SPARSE_LAYOUTS = new Set(['title-slide', 'section-header', 'main-point', 'big-number']);
const MIN_CONTENT_ELEMENTS = 3;
const FULL_HEIGHT_DECORATION = 0.8;

function isContent(p: PlacedElement, ctx: DeckContext): boolean {
  if (p.el.type === 'group' || paintsNothing(p.el)) return false;
  if (isBackground(p.el, p.box, ctx) || isFooterLike(p, ctx)) return false;
  if (p.el.type === 'shape' && !hasText(p.el) && p.box.h >= ctx.slideH * FULL_HEIGHT_DECORATION) {
    return false;
  }
  return true;
}

export function checkEmptyRegion(
  slide: Slide,
  slideIndex: number,
  placed: PlacedElement[],
  ctx: DeckContext,
): Finding[] {
  if (SPARSE_LAYOUTS.has(slide.layoutId)) return [];
  const content = placed.filter((p) => isContent(p, ctx));
  if (content.length < MIN_CONTENT_ELEMENTS) return [];

  const safeTop = ctx.opts.edgeMarginInches * PX_PER_INCH;
  const safeBottom = ctx.slideH - 0.9 * PX_PER_INCH;
  const safeH = safeBottom - safeTop;
  if (safeH <= 0) return [];

  const bottom = Math.max(
    ...content.map((p) => {
      const b = paintedBox(p, ctx);
      return b.y + b.h;
    }),
  );
  const band = safeBottom - Math.max(bottom, safeTop);
  const fraction = band / safeH;
  if (fraction < ctx.opts.emptyRegionMinFraction) return [];
  return [
    {
      rule: 'empty-region',
      severity: fraction >= ctx.opts.emptyRegionWarnFraction ? 'warning' : 'info',
      slideId: slide.id,
      slideIndex,
      message:
        `bottom ${Math.round(fraction * 100)}% of the safe area is empty ` +
        `(content ends at y=${fmt(bottom)}px of ${fmt(safeBottom)}px); ` +
        `spread the content or enlarge it`,
    },
  ];
}
