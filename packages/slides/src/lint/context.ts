/**
 * Shared, Node-safe geometry and text-layout helpers for the slide lint
 * rules and the layout report. Everything here reads the model and the
 * docs layout engine only — no Canvas, no DOM — with the `TextMeasurer`
 * injected.
 */
import {
  computeLayout,
  normalizeBlockStyle,
  type Block,
  type DocumentLayout,
  type TextMeasurer,
} from '@wafflebase/docs';
import { computeAutofitScale, scaleBlocks } from '../model/autofit';
import {
  isBlocksEmpty,
  type Element,
  type Frame,
  type TextBody,
  type TextInset,
} from '../model/element';
import { boundingBox } from '../model/frame';
import { buildElementWorldLookup } from '../model/group';
import { GENERATED_SHAPE_TEXT_RECTS } from '../view/canvas/shapes/shape-text-rects.generated';
import {
  deckFontScale,
  deckSlideHeight,
  DOCS_PX_PER_PT,
  SLIDE_WIDTH,
  type SlidesDocument,
  type Slide,
} from '../model/presentation';
import type { Theme } from '../model/theme';
import { estimateMeasurer } from './estimate-measurer';
import type { LintOptions } from './types';

export type Box = { x: number; y: number; w: number; h: number };

/**
 * Slide pixels per inch. The canvas is always 1920 px wide, which the
 * product treats as a 13.333-inch widescreen slide (`SLIDE_WIDTH / 13.333`).
 */
export const PX_PER_INCH = SLIDE_WIDTH / (40 / 3);
/** Slide pixels per point on that 13.333-inch slide (= 2). */
export const SLIDE_PX_PER_PT = PX_PER_INCH / 72;

// Mirrors SHAPE_TEXT_PADDING in the canvas shape renderer (kept local so
// this module stays free of view/Canvas imports).
export const SHAPE_PAD: TextInset = { left: 14.4, top: 7.2, right: 14.4, bottom: 7.2 };
const ZERO_INSET: TextInset = { left: 0, top: 0, right: 0, bottom: 0 };

/** Minimal deck shape; a full `SlidesDocument` satisfies it. */
export type LintableDeck = Pick<SlidesDocument, 'slides' | 'meta'> &
  Partial<SlidesDocument>;

/** The deck-wide facts every rule needs, computed once. */
export type DeckContext = {
  doc: LintableDeck;
  theme: Theme | undefined;
  slideW: number;
  slideH: number;
  /** `deckFontScale(meta)` — the PPTX-import font pre-scale. */
  fontScale: number;
  measurer: TextMeasurer;
  opts: Required<Omit<LintOptions, 'measurer'>>;
};

export function buildContext(
  doc: DeckContext['doc'],
  options: LintOptions = {},
): DeckContext {
  const meta = doc.meta ?? ({} as SlidesDocument['meta']);
  return {
    doc,
    theme: doc.themes?.find((t) => t.id === meta.themeId) ?? doc.themes?.[0],
    slideW: SLIDE_WIDTH,
    slideH: deckSlideHeight({ slideHeight: meta.slideHeight }),
    fontScale: deckFontScale({ pxPerPt: meta.pxPerPt }),
    measurer: options.measurer ?? estimateMeasurer(),
    opts: {
      rules: options.rules ?? [
        'contrast',
        'out-of-bounds',
        'overlap',
        'edge-margin',
        'min-font',
        'overflow',
      ],
      ignoreElementIds: options.ignoreElementIds ?? [],
      overlapMinFraction: options.overlapMinFraction ?? 0.15,
      edgeMarginInches: options.edgeMarginInches ?? 0.5,
      minFontPt: options.minFontPt ?? 12,
      minFooterFontPt: options.minFooterFontPt ?? 9,
      boundsTolerance: options.boundsTolerance ?? 2,
      overflowTolerance: options.overflowTolerance ?? 1,
    },
  };
}

/** One element as painted: its world box and its paint order on the slide. */
export type PlacedElement = {
  el: Element;
  box: Box;
  /** Paint order among top-level elements (later paints on top). */
  z: number;
  /** True for an element nested in a group (its frame is group-local). */
  nested: boolean;
  /** The element's world frame (group transforms composed). */
  world: Frame;
  /**
   * Vertical scale from the element's own frame to the world: 1 at top
   * level, the composed group scale for a group child. Painted text sizes
   * scale with it.
   */
  scale: number;
};

/**
 * Every element on a slide with its world bounding box. Top-level elements
 * come first in paint order; group descendants follow with their composed
 * world frame and the z of their top-level group. Connectors are skipped —
 * no rule reads them.
 */
export function placeElements(slide: Slide, ctx: DeckContext): PlacedElement[] {
  const out: PlacedElement[] = [];
  const ignore = new Set(ctx.opts.ignoreElementIds);
  const world = buildElementWorldLookup(slide.elements);
  slide.elements.forEach((el, z) => {
    if (el.type === 'connector' || ignore.has(el.id)) return;
    out.push({ el, box: boundingBox(el.frame), z, nested: false, world: el.frame, scale: 1 });
    if (el.type === 'group') {
      for (const child of descendants(el)) {
        if (child.type === 'connector' || ignore.has(child.id)) continue;
        const w = (world.get(child.id) ?? child).frame;
        const scale = child.frame.h > 0 ? w.h / child.frame.h : 1;
        out.push({ el: child, box: boundingBox(w), z, nested: true, world: w, scale });
      }
    }
  });
  return out;
}

function descendants(el: Element): Element[] {
  if (el.type !== 'group') return [];
  return el.data.children.flatMap((c) => [c, ...descendants(c)]);
}

export type TextTarget = { body: TextBody; inset: TextInset };

export function textTarget(el: Element): TextTarget | undefined {
  if (el.type === 'text') {
    return { body: el.data, inset: el.data.inset ?? ZERO_INSET };
  }
  if (el.type === 'shape' && el.data.text) {
    return { body: el.data.text, inset: shapeInset(el, el.data.text.inset ?? SHAPE_PAD) };
  }
  return undefined;
}

/** The element's plain text, blocks joined by spaces. */
export function elementText(el: Element): string {
  const t = textTarget(el);
  if (!t) return '';
  return t.body.blocks
    .map((b) => (b.inlines ?? []).map((i) => i.text).join(''))
    .join(' ')
    .trim();
}

/**
 * Mirrors the canvas `shapeTextInset`: a preset shape (ellipse, callouts,
 * round rect, …) lays its text out inside the OOXML preset text rectangle,
 * then inside the padding.
 */
function shapeInset(el: Extract<Element, { type: 'shape' }>, pad: TextInset): TextInset {
  const rect = GENERATED_SHAPE_TEXT_RECTS[el.data.kind];
  if (!rect) return { ...pad };
  const { w, h } = el.frame;
  return {
    left: rect.l * w + pad.left,
    top: rect.t * h + pad.top,
    right: (1 - rect.r) * w + pad.right,
    bottom: (1 - rect.b) * h + pad.bottom,
  };
}

export function hasText(el: Element): boolean {
  const t = textTarget(el);
  return !!t && !isBlocksEmpty(t.body.blocks);
}

/**
 * A text body laid out the way the canvas renderer lays it out: block
 * styles normalized, the deck font pre-scale applied, then shrink-autofit.
 * Coordinates are element-local (0,0 = the frame's top-left).
 */
export type TextLayout = {
  layout: DocumentLayout;
  /** Inner content box (frame minus inset). */
  innerW: number;
  innerH: number;
  inset: TextInset;
  /** Shrink-autofit scale applied on top of the deck pre-scale (1 = none). */
  shrinkScale: number;
  /** Laid-out text height before any growth. */
  textHeight: number;
  lineCount: number;
  /** Lines painted wholly outside the inner box (none of the line is inside it). */
  linesOutside: number;
  /**
   * Element-local box around the painted glyphs (line extents horizontally,
   * the em box of each line vertically), or undefined if no text.
   */
  ink: Box | undefined;
};

const layoutCache = new WeakMap<DeckContext, Map<Element, TextLayout | undefined>>();

export function layoutText(el: Element, ctx: DeckContext): TextLayout | undefined {
  let cache = layoutCache.get(ctx);
  if (!cache) layoutCache.set(ctx, (cache = new Map()));
  if (cache.has(el)) return cache.get(el);
  const tl = computeTextLayout(el, ctx);
  cache.set(el, tl);
  return tl;
}

function computeTextLayout(el: Element, ctx: DeckContext): TextLayout | undefined {
  const target = textTarget(el);
  if (!target || isBlocksEmpty(target.body.blocks)) return undefined;
  const { body, inset } = target;
  const innerW = Math.max(0, el.frame.w - inset.left - inset.right);
  const innerH = Math.max(0, el.frame.h - inset.top - inset.bottom);

  let blocks: Block[] = body.blocks.map((b) => ({
    ...b,
    style: normalizeBlockStyle(b.style),
  }));
  if (ctx.fontScale !== 1) blocks = scaleBlocks(blocks, ctx.fontScale);
  let shrinkScale = 1;
  if (body.autofit === 'shrink') {
    shrinkScale = computeAutofitScale(blocks, ctx.measurer, innerW, innerH, 0);
    if (shrinkScale !== 1) blocks = scaleBlocks(blocks, shrinkScale);
  }
  const { layout } = computeLayout(blocks, ctx.measurer, innerW);
  const textHeight = layout.totalHeight;

  // Mirrors the canvas `computeVerticalOriginY`: a body taller than its box
  // overflows downward when top-anchored, both ways when middle-anchored and
  // upward when bottom-anchored.
  const anchor = body.verticalAnchor ?? (el.type === 'shape' ? 'middle' : 'top');
  const slack = innerH - textHeight;
  const originY =
    inset.top + (anchor === 'middle' ? slack / 2 : anchor === 'bottom' ? slack : 0);

  let lineCount = 0;
  let linesOutside = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const lb of layout.blocks) {
    for (const line of lb.lines) {
      const text = line.runs.some((r) => r.text.trim() !== '');
      if (!text) continue;
      lineCount++;
      for (const run of line.runs) {
        if (run.text.trim() === '') continue;
        minX = Math.min(minX, lb.x + run.x);
        maxX = Math.max(maxX, lb.x + run.x + run.width);
      }
      const top = originY + lb.y + line.y;
      if (top >= inset.top + innerH || top + line.height <= inset.top) linesOutside++;
      // Vertical ink is the glyphs' em box, not the line box: the leading a
      // line-height multiplier adds above and below is empty space, and
      // counting it makes closely stacked labels "collide".
      const em = Math.min(line.height, line.maxFontSizePx ?? line.height);
      const glyphTop = lb.y + line.y + (line.height - em) / 2;
      minY = Math.min(minY, glyphTop);
      maxY = Math.max(maxY, glyphTop + em);
    }
  }
  const ink =
    lineCount > 0
      ? { x: inset.left + minX, y: originY + minY, w: maxX - minX, h: maxY - minY }
      : undefined;
  return {
    layout,
    innerW,
    innerH,
    inset,
    shrinkScale,
    textHeight,
    lineCount,
    linesOutside,
    ink,
  };
}

/** One painted run of text, with its size in slide points. */
export type TextRun = {
  text: string;
  /** Rendered size in slide points (see {@link slidePtFromStoredPt}). */
  pt: number;
  bold: boolean;
  color: unknown;
  /** Inline highlight (`backgroundColor`), painted behind the run. */
  highlight: unknown;
};

/**
 * Point size as it appears on the slide. The stored `fontSize` is in docs
 * points (96 DPI); the deck pre-scale and shrink are already folded into
 * the laid-out runs. The result is normalized to the 13.333-inch slide the
 * 1920-px canvas represents, so 12 means "looks like 12 pt in a
 * widescreen deck" whatever the deck's origin.
 */
export function slidePtFromStoredPt(pt: number): number {
  return (pt * DOCS_PX_PER_PT) / SLIDE_PX_PER_PT;
}

/** Runs as painted; `scale` is the element's group scale ({@link PlacedElement.scale}). */
export function textRuns(tl: TextLayout, scale = 1): TextRun[] {
  const out: TextRun[] = [];
  for (const lb of tl.layout.blocks) {
    for (const line of lb.lines) {
      for (const run of line.runs) {
        if (run.text.trim() === '') continue;
        const style = run.inline.style ?? {};
        out.push({
          text: run.text,
          pt: slidePtFromStoredPt(style.fontSize ?? 11) * scale,
          bold: !!style.bold,
          color: style.color,
          highlight: style.backgroundColor,
        });
      }
    }
  }
  return out;
}

/** World box of the painted text (falls back to the frame). */
export function inkBox(placed: PlacedElement, tl: TextLayout | undefined): Box {
  const f = placed.el.frame;
  const w = placed.world;
  // A rotated element — or a child of a rotated group — has no axis-aligned
  // mapping from local ink to world: judge it by its bounding box.
  if (!tl?.ink || w.rotation || f.w <= 0 || f.h <= 0) return placed.box;
  const sx = w.w / f.w;
  const sy = w.h / f.h;
  return {
    x: w.x + tl.ink.x * sx,
    y: w.y + tl.ink.y * sy,
    w: tl.ink.w * sx,
    h: tl.ink.h * sy,
  };
}

/** Whether the element paints a box of its own (a fill or a border). */
export function paintsBox(el: Element): boolean {
  if (el.type === 'text') return !!el.data.fill || !!el.data.stroke;
  if (el.type === 'shape') return !!el.data.fill || !!el.data.stroke;
  return el.type !== 'group' && el.type !== 'connector';
}

/** An element nothing of which reaches the screen: an empty, unfilled text box or shape. */
export function paintsNothing(el: Element): boolean {
  if (el.type === 'image') return (el.data.opacity ?? 1) <= 0;
  if (el.type !== 'text' && el.type !== 'shape') return false;
  return !hasText(el) && !paintsBox(el);
}

/**
 * The region an element actually covers when painted. Text is measured by
 * its ink — the laid-out lines — not by its frame: a wide, centered title
 * box covers only the middle of its frame, and text that outgrows its frame
 * (a `grow` body authored as JSON, or `none` with too much text) covers
 * more. A filled or bordered box covers its frame as well.
 */
export function paintedBox(placed: PlacedElement, ctx: DeckContext): Box {
  if (!hasText(placed.el)) return placed.box;
  const ink = inkBox(placed, layoutText(placed.el, ctx));
  return paintsBox(placed.el) ? union(ink, placed.box) : ink;
}

export function union(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

export function intersection(a: Box, b: Box): Box | undefined {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.w, b.x + b.w) - x;
  const h = Math.min(a.y + a.h, b.y + b.h) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : undefined;
}

export function encloses(outer: Box, inner: Box, slack = 1): boolean {
  return (
    inner.x >= outer.x - slack &&
    inner.y >= outer.y - slack &&
    inner.x + inner.w <= outer.x + outer.w + slack &&
    inner.y + inner.h <= outer.y + outer.h + slack
  );
}

export function contains(b: Box, x: number, y: number): boolean {
  return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
}

/**
 * A footer-like element: short text in the bottom band of the slide
 * (page numbers, source lines, confidentiality notes). The edge-margin rule
 * exempts these and min-font holds them to the smaller footer minimum.
 */
export function isFooterLike(placed: PlacedElement, ctx: DeckContext): boolean {
  const { box } = placed;
  const band = ctx.slideH - 0.9 * PX_PER_INCH;
  return box.y >= band && box.h <= 0.9 * PX_PER_INCH;
}

export function fmt(n: number): string {
  return String(Math.round(n * 10) / 10);
}
