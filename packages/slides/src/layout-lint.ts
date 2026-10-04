/**
 * Deterministic layout linter: flags visually-broken slides using only
 * geometry and text measurement — no rendering, no vision model.
 *
 * Lives at the package root (not under `view/`) because it must be
 * importable from Node (CLI, backend, CI) without touching Canvas/DOM:
 * it depends only on the model plus the docs layout engine, and takes the
 * `TextMeasurer` as an injected argument.
 *
 * Two rules:
 * - `overlap`  — foreground elements whose frames intersect. Full-bleed /
 *   thin decorative shapes and textless container shapes that fully
 *   enclose the other element are excluded (content-on-background is
 *   intentional).
 * - `overflow` — text whose laid-out height exceeds its box after the
 *   element's autofit mode is applied (see `AutofitMode`).
 */
import {
  computeLayout,
  normalizeBlockStyle,
  type Block,
  type TextMeasurer,
} from '@wafflebase/docs';
import { computeAutofitScale, scaleBlocks } from './model/autofit';
import {
  isBlocksEmpty,
  type Element,
  type TextBody,
  type TextInset,
} from './model/element';
import { boundingBox } from './model/frame';
import {
  deckFontScale,
  deckSlideHeight,
  SLIDE_WIDTH,
  type Meta,
  type Slide,
} from './model/presentation';

export type LayoutFindingKind = 'overlap' | 'overflow';

export type LayoutFinding = {
  slideIndex: number;
  elementId: string;
  kind: LayoutFindingKind;
  detail: string;
};

/** Minimal deck shape; a full `SlidesDocument` satisfies it. */
export type LintableDeck = {
  slides: Slide[];
  meta?: Partial<Pick<Meta, 'pxPerPt' | 'slideHeight'>>;
};

export type LintLayoutOptions = {
  /** Text width measurer (CanvasTextMeasurer in browsers, fontkit in Node). Required for the overflow rule. */
  measurer?: TextMeasurer;
  /** Rules to run. Default both. */
  rules?: LayoutFindingKind[];
  /** Overlap is reported only if the intersection is deeper than this (px) on BOTH axes. Default 4. */
  overlapTolerance?: number;
  /** Exclude background/decorative shapes from overlap checks. Default true. */
  excludeBackground?: boolean;
  /** A textless shape/image covering at least this fraction of the slide is background. Default 0.8. */
  backgroundCoverage?: number;
  /** A textless shape whose thinner side is <= this (px) is decorative (rule, spine, bar). Default 24. */
  decorativeMaxThickness?: number;
  /** Skip overlaps where a textless shape fully encloses the other element (cards/panels). Default true. */
  ignoreContainers?: boolean;
  /** Pixel slack before content height counts as overflow. Default 1. */
  overflowTolerance?: number;
  /** Shrink: also flag when the fitted font scale is below this. Default 0.1 (the engine floor, i.e. only "cannot fit"). */
  minFontScale?: number;
  /** Element ids to ignore entirely. */
  ignoreElementIds?: string[];
};

// Mirrors SHAPE_TEXT_PADDING in the canvas shape renderer (kept local so
// this module stays free of view/Canvas imports).
const SHAPE_PAD: TextInset = { left: 14.4, top: 7.2, right: 14.4, bottom: 7.2 };
const ZERO_INSET: TextInset = { left: 0, top: 0, right: 0, bottom: 0 };

type TextTarget = { body: TextBody; inset: TextInset };

function textTarget(el: Element): TextTarget | undefined {
  if (el.type === 'text') {
    return { body: el.data, inset: el.data.inset ?? ZERO_INSET };
  }
  if (el.type === 'shape' && el.data.text) {
    return { body: el.data.text, inset: el.data.text.inset ?? SHAPE_PAD };
  }
  return undefined;
}

function hasText(el: Element): boolean {
  const t = textTarget(el);
  return !!t && !isBlocksEmpty(t.body.blocks);
}

type Box = { x: number; y: number; w: number; h: number };

function isBackground(
  el: Element,
  box: Box,
  slideW: number,
  slideH: number,
  o: Required<LintLayoutOptions>,
): boolean {
  if (el.type !== 'shape' && el.type !== 'image') return false;
  if (hasText(el)) return false;
  if ((box.w * box.h) / (slideW * slideH) >= o.backgroundCoverage) return true;
  return el.type === 'shape' && Math.min(box.w, box.h) <= o.decorativeMaxThickness;
}

function encloses(outer: Box, inner: Box, slack = 1): boolean {
  return (
    inner.x >= outer.x - slack &&
    inner.y >= outer.y - slack &&
    inner.x + inner.w <= outer.x + outer.w + slack &&
    inner.y + inner.h <= outer.y + outer.h + slack
  );
}

function fmt(n: number): string {
  return String(Math.round(n * 10) / 10);
}

function lintOverlaps(
  slide: Slide,
  slideIndex: number,
  slideW: number,
  slideH: number,
  o: Required<LintLayoutOptions>,
  out: LayoutFinding[],
): void {
  const items = slide.elements
    .filter((el) => el.type !== 'connector' && !o.ignoreElementIds.includes(el.id))
    .map((el) => ({ el, box: boundingBox(el.frame) }))
    .filter(
      ({ el, box }) =>
        !(o.excludeBackground && isBackground(el, box, slideW, slideH, o)),
    );

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      const iw = Math.min(a.box.x + a.box.w, b.box.x + b.box.w) - Math.max(a.box.x, b.box.x);
      const ih = Math.min(a.box.y + a.box.h, b.box.y + b.box.h) - Math.max(a.box.y, b.box.y);
      if (iw <= o.overlapTolerance || ih <= o.overlapTolerance) continue;
      if (o.ignoreContainers) {
        const aBox = !hasText(a.el) && a.el.type === 'shape' && encloses(a.box, b.box);
        const bBox = !hasText(b.el) && b.el.type === 'shape' && encloses(b.box, a.box);
        if (aBox || bBox) continue;
      }
      out.push({
        slideIndex,
        elementId: b.el.id,
        kind: 'overlap',
        detail: `overlaps ${a.el.id} by ${fmt(iw)}x${fmt(ih)}px`,
      });
    }
  }
}

function lintOverflow(
  el: Element,
  slideIndex: number,
  slideH: number,
  fontScale: number,
  o: Required<LintLayoutOptions>,
  measurer: TextMeasurer,
  out: LayoutFinding[],
): void {
  const target = textTarget(el);
  if (!target || isBlocksEmpty(target.body.blocks)) return;
  const { body, inset } = target;
  const innerW = Math.max(0, el.frame.w - inset.left - inset.right);
  const innerH = Math.max(0, el.frame.h - inset.top - inset.bottom);

  let blocks: Block[] = body.blocks.map((b) => ({
    ...b,
    style: normalizeBlockStyle(b.style),
  }));
  if (fontScale !== 1) blocks = scaleBlocks(blocks, fontScale);

  const height = (bs: Block[]) => computeLayout(bs, measurer, innerW).layout.totalHeight;
  const mode = body.autofit ?? 'grow';
  const tol = o.overflowTolerance;

  if (mode === 'none') {
    const h = height(blocks);
    if (h > innerH + tol) {
      out.push({
        slideIndex,
        elementId: el.id,
        kind: 'overflow',
        detail: `text height ${fmt(h)}px exceeds box ${fmt(innerH)}px (autofit none)`,
      });
    }
  } else if (mode === 'shrink') {
    const scale = computeAutofitScale(blocks, measurer, innerW, innerH, 0);
    const h = height(scaleBlocks(blocks, scale));
    if (h > innerH + tol) {
      out.push({
        slideIndex,
        elementId: el.id,
        kind: 'overflow',
        detail: `text height ${fmt(h)}px exceeds box ${fmt(innerH)}px even at min scale ${fmt(scale)}`,
      });
    } else if (scale < o.minFontScale) {
      out.push({
        slideIndex,
        elementId: el.id,
        kind: 'overflow',
        detail: `shrink scale ${fmt(scale)} is below minimum ${fmt(o.minFontScale)}`,
      });
    }
  } else {
    const grown = height(blocks) + inset.top + inset.bottom;
    const bottom = el.frame.y + Math.max(el.frame.h, grown);
    if (bottom > slideH + tol) {
      out.push({
        slideIndex,
        elementId: el.id,
        kind: 'overflow',
        detail: `grown box bottom ${fmt(bottom)}px exceeds slide height ${fmt(slideH)}px (autofit grow)`,
      });
    }
  }
}

/**
 * Lint every slide of a deck. Pure and deterministic. Findings are ordered
 * by slide, then rule (overlap before overflow), then element order.
 */
export function lintLayout(
  deck: LintableDeck,
  opts: LintLayoutOptions = {},
): LayoutFinding[] {
  const o: Required<LintLayoutOptions> = {
    measurer: opts.measurer as TextMeasurer,
    rules: opts.rules ?? ['overlap', 'overflow'],
    overlapTolerance: opts.overlapTolerance ?? 4,
    excludeBackground: opts.excludeBackground ?? true,
    backgroundCoverage: opts.backgroundCoverage ?? 0.8,
    decorativeMaxThickness: opts.decorativeMaxThickness ?? 24,
    ignoreContainers: opts.ignoreContainers ?? true,
    overflowTolerance: opts.overflowTolerance ?? 1,
    minFontScale: opts.minFontScale ?? 0.1,
    ignoreElementIds: opts.ignoreElementIds ?? [],
  };
  const meta = deck.meta ?? {};
  const slideW = SLIDE_WIDTH;
  const slideH = deckSlideHeight({ slideHeight: meta.slideHeight });
  const fontScale = deckFontScale({ pxPerPt: meta.pxPerPt });
  const findings: LayoutFinding[] = [];

  deck.slides.forEach((slide, slideIndex) => {
    if (o.rules.includes('overlap')) {
      lintOverlaps(slide, slideIndex, slideW, slideH, o, findings);
    }
    if (o.rules.includes('overflow') && o.measurer) {
      for (const el of slide.elements) {
        if (o.ignoreElementIds.includes(el.id)) continue;
        lintOverflow(el, slideIndex, slideH, fontScale, o, o.measurer, findings);
      }
    }
  });
  return findings;
}
