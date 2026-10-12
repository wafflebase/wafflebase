/**
 * `contrast` — text whose color is too close to what it is painted over.
 *
 * WCAG 2 AA: 4.5:1 for body text, 3:1 for large text (18 pt, or 14 pt
 * bold, measured in slide points). The backdrop is resolved at three
 * points across the middle of the painted text: the element's own fill,
 * then whatever paints beneath it (filled shapes and filled text boxes,
 * alpha-composited), then the slide background (slide → layout → master).
 * A gradient counts as its worst stop. An image, table or chart under the
 * text, or a background image, makes the backdrop unknown and the point is
 * skipped rather than guessed.
 *
 * Group children are covered (their backdrop includes what their group
 * painted before them). Not yet covered: text in table cells.
 */
import { resolveBackgroundFill, resolveBackgroundImage } from '../../model/presentation';
import type { Slide, SlidesDocument } from '../../model/presentation';
import { resolveColor, type Fill, type Theme, type ThemeColor } from '../../model/theme';
import { contrastRatio, over, parseCssColor, toHex, type Rgba } from '../color';
import {
  contains,
  fmt,
  hasText,
  inkBox,
  layoutText,
  textRuns,
  type DeckContext,
  type PlacedElement,
} from '../context';
import type { Finding } from '../types';

export function checkContrast(
  slide: Slide,
  slideIndex: number,
  placed: PlacedElement[],
  ctx: DeckContext,
): Finding[] {
  const theme = ctx.theme;
  if (!theme) return [];
  const findings: Finding[] = [];

  for (const p of placed) {
    if (!hasText(p.el)) continue;
    const tl = layoutText(p.el, ctx);
    if (!tl) continue;
    const ink = inkBox(p, tl);
    const ys = ink.y + ink.h / 2;
    const xs = [ink.x + ink.w * 0.1, ink.x + ink.w / 2, ink.x + ink.w * 0.9];

    let worst: { ratio: number; need: number; fg: Rgba; bg: Rgba; pt: number } | undefined;
    for (const run of textRuns(tl, p.scale)) {
      const fg = textColor(run.color, theme);
      if (!fg) continue;
      const need = run.pt >= 18 || (run.bold && run.pt >= 14) ? 3 : 4.5;
      for (const x of xs) {
        // An inline highlight is the run's own backdrop.
        const hl = run.highlight != null ? textColor(run.highlight, theme) : undefined;
        const under = backdropAt(p, placed, x, ys, slide, ctx, theme);
        const backdrops =
          hl && hl.a >= 1 ? [hl] : hl && under ? under.map((u) => over(hl, u)) : under;
        if (!backdrops) continue;
        for (const bg of backdrops) {
          const ratio = contrastRatio(fg.a < 1 ? over(fg, bg) : fg, bg);
          if (ratio >= need) continue;
          if (!worst || ratio / need < worst.ratio / worst.need) {
            worst = { ratio, need, fg, bg, pt: run.pt };
          }
        }
      }
    }
    if (worst) {
      findings.push({
        rule: 'contrast',
        severity: worst.ratio < 3 ? 'error' : 'warning',
        slideId: slide.id,
        slideIndex,
        elementId: p.el.id,
        message:
          `text ${toHex(worst.fg)} on ${toHex(worst.bg)} is ${fmt(worst.ratio)}:1, ` +
          `needs ${worst.need}:1 at ${fmt(worst.pt)}pt`,
      });
    }
  }
  return findings;
}

/** Mirrors the canvas `makeColorResolver`: unset or the docs default black means the theme text color. */
function textColor(c: unknown, theme: Theme): Rgba | undefined {
  // (A highlight never reaches the unset branch: callers pass it only when set.)
  if (c == null) return parseCssColor(theme.colors.text);
  if (typeof c === 'string') {
    return parseCssColor(c.toLowerCase() === '#000000' ? theme.colors.text : c);
  }
  return parseCssColor(resolveColor(c as ThemeColor, theme));
}

/** Opaque colors of the fill (a gradient yields one per stop), or undefined for none. */
function fillColors(fill: Fill | string | undefined, theme: Theme): Rgba[] | undefined {
  if (fill == null) return undefined;
  if (typeof fill === 'string') {
    const c = parseCssColor(fill);
    return c ? [c] : undefined;
  }
  if (fill.kind === 'gradient') {
    const stops = fill.stops
      .map((s) => parseCssColor(resolveColor(s.color, theme)))
      .filter((c): c is Rgba => !!c);
    return stops.length > 0 ? stops : undefined;
  }
  const c = parseCssColor(resolveColor(fill, theme));
  return c ? [c] : undefined;
}

/**
 * The opaque color(s) behind point (x, y) under `target`, or undefined when
 * something whose pixels we cannot know (an image, table, chart or
 * background image) is in the way.
 */
function backdropAt(
  target: PlacedElement,
  placed: PlacedElement[],
  x: number,
  y: number,
  slide: Slide,
  ctx: DeckContext,
  theme: Theme,
): Rgba[] | undefined {
  // Layers from the target's own fill downward, topmost first: elements of
  // earlier top-level z, plus — for a group child — what its group painted
  // before it (`placed` lists a group's descendants in paint order).
  const at = placed.indexOf(target);
  const below = placed
    .filter(
      (q, i) =>
        q !== target &&
        (q.z < target.z || (target.nested && q.nested && q.z === target.z && i < at)),
    )
    .reverse();
  const layers: PlacedElement[] = [target, ...below];
  return resolveLayers(layers, 0, x, y, slide, ctx, theme);
}

function resolveLayers(
  layers: PlacedElement[],
  from: number,
  x: number,
  y: number,
  slide: Slide,
  ctx: DeckContext,
  theme: Theme,
): Rgba[] | undefined {
  for (let i = from; i < layers.length; i++) {
    const { el, box } = layers[i];
    if (!contains(box, x, y)) continue;
    let colors: Rgba[] | undefined;
    if (el.type === 'shape') colors = fillColors(el.data.fill, theme);
    else if (el.type === 'text') colors = fillColors(el.data.fill, theme);
    else if (el.type === 'image') {
      if ((el.data.opacity ?? 1) <= 0) continue;
      return undefined;
    } else if (el.type === 'table' || el.type === 'chart') return undefined;
    if (!colors) continue;
    if (colors.every((c) => c.a >= 1)) return colors;
    const under = resolveLayers(layers, i + 1, x, y, slide, ctx, theme);
    if (!under) return undefined;
    return colors.flatMap((c) => under.map((u) => over(c, u)));
  }
  return slideBackground(slide, ctx, theme);
}

function slideBackground(slide: Slide, ctx: DeckContext, theme: Theme): Rgba[] | undefined {
  const doc = ctx.doc;
  const full: SlidesDocument | undefined =
    doc.layouts && doc.masters ? (doc as SlidesDocument) : undefined;
  // Agent-written JSON may omit `background`; treat it as inherit.
  const s: Slide = slide.background ? slide : { ...slide, background: {} };
  if (full ? resolveBackgroundImage(s, full) : s.background.image) return undefined;
  const fill = full
    ? resolveBackgroundFill(s, full)
    : (s.background.fill ?? { kind: 'role', role: 'background' });
  const colors = fillColors(fill, theme);
  // Whatever shows through a translucent background is the canvas white.
  return colors?.map((c) => (c.a < 1 ? over(c, { r: 255, g: 255, b: 255, a: 1 }) : c));
}
