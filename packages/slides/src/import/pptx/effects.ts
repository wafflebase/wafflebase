import type {
  DropShadow,
  Effects,
  ImageRecolor,
  Reflection,
} from '../../model/element';
import type { ThemeColor } from '../../model/theme';
import { parseColorFromContainer, type ClrMap } from './color';
import type { EmuScale } from './geometry';
import { emuToStrokePx, rotEmuToRad } from './geometry';
import { attr, attrInt, child } from './xml';

/**
 * Parse OOXML `<a:effectLst>` on a `<p:spPr>` / `<p:grpSpPr>` /
 * graphic-frame `<p:spPr>` into our paint-time {@link Effects} bag.
 *
 * Only the two effects our renderer paints are imported — `<a:outerShdw>`
 * and `<a:reflection>`. Other effect kinds (`<a:glow>`, `<a:softEdge>`,
 * `<a:innerShdw>`, …) are left out; the model has no slot for them and a
 * partial import would mislead. Returns `undefined` when neither is
 * present so callers keep `data.effects` absent (no schema noise).
 */
export function parseEffects(
  spPr: Element | undefined,
  scale: EmuScale,
  clrMap?: ClrMap,
): Effects | undefined {
  const effectLst = spPr ? child(spPr, 'effectLst') : undefined;
  if (!effectLst) return undefined;
  const shadow = parseOuterShadow(child(effectLst, 'outerShdw'), scale, clrMap);
  const reflection = parseReflection(child(effectLst, 'reflection'), scale);
  if (!shadow && !reflection) return undefined;
  return {
    ...(shadow ? { shadow } : {}),
    ...(reflection ? { reflection } : {}),
  };
}

/**
 * `<a:outerShdw dir dist blurRad>` + a color child → {@link DropShadow}.
 * `dir` is OOXML 60000ths/deg, `dist`/`blurRad` are EMU. The color's
 * `<a:alpha>` becomes `opacity` (and is stripped from `color`) so the
 * renderer's single opacity path applies — see the note in
 * `parseShadowColor`.
 */
function parseOuterShadow(
  outerShdw: Element | undefined,
  scale: EmuScale,
  clrMap?: ClrMap,
): DropShadow | undefined {
  if (!outerShdw) return undefined;
  const resolved = parseShadowColor(outerShdw, clrMap);
  if (!resolved) return undefined;
  return {
    color: resolved.color,
    opacity: resolved.opacity,
    angle: rotEmuToRad(attrInt(outerShdw, 'dir') ?? 0),
    distance: emuToStrokePx(attrInt(outerShdw, 'dist') ?? 0, scale),
    blur: emuToStrokePx(attrInt(outerShdw, 'blurRad') ?? 0, scale),
  };
}

/**
 * Resolve the shadow's color child to a {@link ThemeColor} and pull its
 * alpha out into a separate opacity. The alpha is *removed* from the
 * color: `DropShadow.opacity` is the single source of shadow alpha, and
 * `resolveColor` would otherwise bake a sub-1 alpha into an `rgba()`
 * string that the renderer's `colorWithAlpha` (which only reads opacity)
 * silently drops. Absent `<a:alpha>` ⇒ opaque (`1`).
 */
function parseShadowColor(
  outerShdw: Element,
  clrMap?: ClrMap,
): { color: ThemeColor; opacity: number } | undefined {
  const resolved = parseColorFromContainer(outerShdw, clrMap);
  if (!resolved) return undefined;
  const opacity = 'alpha' in resolved && resolved.alpha != null ? resolved.alpha : 1;
  const color = { ...resolved } as ThemeColor & { alpha?: number };
  delete color.alpha;
  return { color: color as ThemeColor, opacity };
}

/**
 * `<a:reflection stA dist endPos>` → {@link Reflection}. `stA` (start
 * alpha) and `endPos` (fade length) are OOXML thousandths-of-a-percent;
 * `dist` is EMU. Missing attributes fall back to the OOXML schema
 * defaults (`stA`/`endPos` = 100000 ⇒ `1`, `dist` = 0).
 */
function parseReflection(
  reflection: Element | undefined,
  scale: EmuScale,
): Reflection | undefined {
  if (!reflection) return undefined;
  const stA = attrInt(reflection, 'stA');
  const endPos = attrInt(reflection, 'endPos');
  return {
    opacity: stA != null ? clamp01(stA / 100_000) : 1,
    distance: emuToStrokePx(attrInt(reflection, 'dist') ?? 0, scale),
    size: endPos != null ? clamp01(endPos / 100_000) : 1,
  };
}

/**
 * Read the screen-reader description from a shape / pic / table /
 * graphic-frame's non-visual container: `<p:nv*Pr><p:cNvPr descr="...">`.
 * Mirrors `pptxIdOf`'s `nv*Pr` walk in `shape.ts`. Empty string ⇒
 * `undefined` so a `descr=""` doesn't seed a blank `alt`.
 */
export function readAltText(el: Element): string | undefined {
  for (let i = 0; i < el.childNodes.length; i++) {
    const n = el.childNodes[i];
    if (n.nodeType !== 1) continue;
    const c = n as Element;
    if (!c.localName.startsWith('nv')) continue;
    const cNvPr = child(c, 'cNvPr');
    if (!cNvPr) continue;
    const descr = attr(cNvPr, 'descr');
    return descr && descr.length > 0 ? descr : undefined;
  }
  return undefined;
}

/** Image-only adjustments parsed from an `<a:blip>`'s effect children. */
export type ImageAdjustments = {
  recolor?: ImageRecolor;
  brightness?: number;
  contrast?: number;
};

/**
 * Parse the recolor / brightness / contrast effects PowerPoint nests
 * inside `<a:blip>`:
 *  - `<a:grayscl>` → `'grayscale'`.
 *  - `<a:duotone>` → `'sepia'` when it carries a warm (brown) `srgbClr`
 *    accent, else `'grayscale'`. Theme-tinted duotone is deferred (the
 *    model only has the three CSS-filter presets).
 *  - `<a:lum bright contrast>` → `brightness` / `contrast`, OOXML
 *    thousandths-of-a-percent (`-100000..100000`) → `[-1, 1]`.
 *
 * `<a:clrChange>` (arbitrary one-color swap) has no preset analog and is
 * intentionally left unmapped. Returns `undefined` when nothing maps.
 */
export function parseImageAdjustments(
  blip: Element | undefined,
): ImageAdjustments | undefined {
  if (!blip) return undefined;
  const out: ImageAdjustments = {};

  if (child(blip, 'grayscl')) out.recolor = 'grayscale';
  const duotone = child(blip, 'duotone');
  if (duotone) out.recolor = isSepiaDuotone(duotone) ? 'sepia' : 'grayscale';

  const lum = child(blip, 'lum');
  if (lum) {
    const bright = attrInt(lum, 'bright');
    if (bright != null && bright !== 0) {
      out.brightness = clampSigned(bright / 100_000);
    }
    const contrast = attrInt(lum, 'contrast');
    if (contrast != null && contrast !== 0) {
      out.contrast = clampSigned(contrast / 100_000);
    }
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * A duotone reads as "sepia" when one of its literal `srgbClr` tones is a
 * warm brown (`R > G ≥ B` with a real red→blue spread). A neutral
 * black→white duotone — the grayscale form — fails this and maps to
 * `'grayscale'`. `schemeClr` tones are ignored (can't resolve to a
 * concrete hue without the theme here); such duotones fall to grayscale.
 */
function isSepiaDuotone(duotone: Element): boolean {
  for (let i = 0; i < duotone.childNodes.length; i++) {
    const n = duotone.childNodes[i];
    if (n.nodeType !== 1) continue;
    const el = n as Element;
    if (el.localName !== 'srgbClr') continue;
    const val = attr(el, 'val');
    if (!val || val.length < 6) continue;
    const r = parseInt(val.slice(0, 2), 16);
    const g = parseInt(val.slice(2, 4), 16);
    const b = parseInt(val.slice(4, 6), 16);
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) continue;
    if (r > g && g >= b && r - b > 24) return true;
  }
  return false;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function clampSigned(v: number): number {
  return Math.max(-1, Math.min(1, v));
}
