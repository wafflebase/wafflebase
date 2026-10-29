/**
 * Layout report: what each element looks like once laid out, computed in
 * Node with the same layout engine the canvas renderer uses — line count,
 * text height, whether the text fits, and how much of the element is on
 * the slide. The cheap first pass an authoring agent runs before (or
 * instead of) rendering PNGs.
 *
 * Caveat: with the default {@link estimateMeasurer} line breaks are an
 * estimate; a fontkit measurer with the deck's real fonts registered, or a
 * browser render, is exact.
 */
import type { ElementType } from '../model/element';
import {
  buildContext,
  fmt,
  layoutText,
  paintedBox,
  placeElements,
  textTarget,
  type Box,
} from './context';
import type { LintableDeck } from './context';
import type { LintOptions } from './types';

export type ElementLayout = {
  elementId: string;
  type: ElementType;
  /** World bounding box, slide px (rounded to 0.1). */
  box: Box;
  /** Group descendant (its frame is group-local; text checks skip some rules). */
  nested: boolean;
  /** Fraction of the element's area that lies on the slide, 0..1. */
  visibleFraction: number;
  text?: {
    autofit: 'none' | 'shrink' | 'grow';
    lines: number;
    /** Laid-out text height, px. */
    height: number;
    /** Inner box height (frame minus inset), px. */
    boxHeight: number;
    /** Shrink-autofit scale (1 = not shrunk). */
    shrinkScale: number;
    /** Text taller than its box — for `grow`, the box will grow to `paintedHeight`. */
    overflows: boolean;
    /** Height of the painted text (its ink), which can exceed the box. */
    paintedHeight: number;
  };
};

export type SlideLayout = {
  slideId: string;
  slideIndex: number;
  elements: ElementLayout[];
};

const round = (b: Box): Box => ({
  x: Number(fmt(b.x)),
  y: Number(fmt(b.y)),
  w: Number(fmt(b.w)),
  h: Number(fmt(b.h)),
});

export function layoutReport(
  doc: LintableDeck,
  options: Pick<LintOptions, 'measurer' | 'ignoreElementIds'> = {},
): SlideLayout[] {
  const ctx = buildContext(doc, options);
  return doc.slides.map((slide, slideIndex) => ({
    slideId: slide.id,
    slideIndex,
    elements: placeElements(slide, ctx).map((p): ElementLayout => {
      const { box } = p;
      const area = box.w * box.h;
      const onW = Math.max(0, Math.min(box.x + box.w, ctx.slideW) - Math.max(box.x, 0));
      const onH = Math.max(0, Math.min(box.y + box.h, ctx.slideH) - Math.max(box.y, 0));
      const out: ElementLayout = {
        elementId: p.el.id,
        type: p.el.type,
        box: round(box),
        nested: p.nested,
        visibleFraction: area > 0 ? Number(((onW * onH) / area).toFixed(3)) : 0,
      };
      const tl = layoutText(p.el, ctx);
      if (tl) {
        const autofit = textTarget(p.el)?.body.autofit ?? 'grow';
        out.text = {
          autofit,
          lines: tl.lineCount,
          height: Number(fmt(tl.textHeight)),
          boxHeight: Number(fmt(tl.innerH)),
          shrinkScale: Number(tl.shrinkScale.toFixed(3)),
          overflows: tl.textHeight > tl.innerH + 1,
          paintedHeight: Number(fmt(paintedBox(p, ctx).h)),
        };
      }
      return out;
    }),
  }));
}
