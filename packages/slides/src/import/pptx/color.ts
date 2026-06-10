import type { ColorRole, ThemeColor } from '../../model/theme';
import { attr, attrInt, child, children } from './xml';

/**
 * OOXML `<p:clrMap>` translation table: logical scheme name (e.g.
 * `bg1`, `tx2`) → actual scheme slot name (e.g. `lt1`, `dk2`). The
 * benchmark deck swaps `bg2` and `tx2` from their identity defaults,
 * so a slide that references `bg2` should resolve to `dk2`, not `lt2`.
 *
 * An empty/missing map is the identity mapping (every key maps to
 * itself).
 */
export type ClrMap = Map<string, string>;

/**
 * Map OOXML `<a:schemeClr val>` tokens to our `ColorRole` keys.
 *
 * OOXML exposes both the original PowerPoint role names (dk1/lt1) and
 * the WordprocessingML-style aliases (tx1/bg1). The clrMap on a master
 * may swap these, but in practice the identity mapping is overwhelmingly
 * what we see; the PR2 scope treats them as synonyms.
 */
const SCHEME_TO_ROLE: Record<string, ColorRole> = {
  dk1: 'text',
  tx1: 'text',
  lt1: 'background',
  bg1: 'background',
  dk2: 'textSecondary',
  tx2: 'textSecondary',
  lt2: 'backgroundAlt',
  bg2: 'backgroundAlt',
  accent1: 'accent1',
  accent2: 'accent2',
  accent3: 'accent3',
  accent4: 'accent4',
  accent5: 'accent5',
  accent6: 'accent6',
  hlink: 'hyperlink',
  folHlink: 'visitedHyperlink',
};

/**
 * Minimal preset-color table covering the few values that show up in
 * real decks. Unknown names fall back to black with no further
 * complaint; PowerPoint exporters almost always emit `<a:srgbClr>` so
 * this path is rare in practice.
 */
const PRESET_COLORS: Record<string, string> = {
  black: '000000',
  white: 'FFFFFF',
  red: 'FF0000',
  green: '008000',
  blue: '0000FF',
  yellow: 'FFFF00',
  gray: '808080',
  grey: '808080',
  cyan: '00FFFF',
  magenta: 'FF00FF',
};

/**
 * Parse a color child container (e.g. `<a:solidFill>`, `<a:lnRef>`,
 * `<a:fgClr>`) — DrawingML wraps the actual color in `<a:srgbClr>` /
 * `<a:schemeClr>` / `<a:sysClr>` / `<a:prstClr>`, optionally with
 * `<a:tint>` / `<a:shade>` modifiers.
 *
 * `clrMap`, when provided, translates logical scheme names through
 * the master's `<p:clrMap>` before looking them up in `SCHEME_TO_ROLE`.
 *
 * Returns `undefined` when no recognised color child is present.
 */
export function parseColorFromContainer(
  container: Element,
  clrMap?: ClrMap,
): ThemeColor | undefined {
  for (let i = 0; i < container.childNodes.length; i++) {
    const n = container.childNodes[i];
    if (n.nodeType !== 1) continue;
    const el = n as Element;
    const color = parseColorElement(el, clrMap);
    if (color) return color;
  }
  return undefined;
}

/** Parse a single `<a:srgbClr>` / `<a:schemeClr>` / `<a:sysClr>` / `<a:prstClr>` element. */
export function parseColorElement(
  el: Element,
  clrMap?: ClrMap,
): ThemeColor | undefined {
  switch (el.localName) {
    case 'srgbClr': {
      const val = attr(el, 'val');
      if (!val) return undefined;
      return applyModifiers({ kind: 'srgb', value: normalizeHex(val) }, el);
    }
    case 'schemeClr': {
      const val = attr(el, 'val');
      if (!val) return undefined;
      const mapped = clrMap?.get(val) ?? val;
      const role = SCHEME_TO_ROLE[mapped];
      if (!role) return undefined; // unknown scheme token (e.g. phClr in placeholders)
      return applyModifiers({ kind: 'role', role }, el);
    }
    case 'sysClr': {
      // PowerPoint stores the last-resolved sRGB in `lastClr`; that's
      // the only reliable value at parse time (the system color itself
      // is by definition variable).
      const lastClr = attr(el, 'lastClr');
      if (!lastClr) return undefined;
      return applyModifiers({ kind: 'srgb', value: normalizeHex(lastClr) }, el);
    }
    case 'prstClr': {
      const val = attr(el, 'val');
      if (!val) return undefined;
      const hex = PRESET_COLORS[val.toLowerCase()] ?? '000000';
      return applyModifiers({ kind: 'srgb', value: normalizeHex(hex) }, el);
    }
    default:
      return undefined;
  }
}

/** Read `<a:alpha val>` (OOXML thousandths) and normalize to `0..1`. */
function readAlpha(el: Element): number | undefined {
  const aEl = children(el, 'alpha')[0];
  if (!aEl) return undefined;
  const v = attrInt(aEl, 'val');
  if (v == null) return undefined;
  return Math.max(0, Math.min(1, v / 100000));
}

/**
 * Resolve a `<a:srgbClr val>` child on a container element to a plain
 * hex string. Used by `theme.ts` to populate the 12 ColorScheme slots,
 * each of which is just a hex string in our model.
 */
export function parseHexInContainer(container: Element): string | undefined {
  const srgb = child(container, 'srgbClr');
  if (srgb) {
    const val = attr(srgb, 'val');
    if (val) return normalizeHex(val);
  }
  const sys = child(container, 'sysClr');
  if (sys) {
    const last = attr(sys, 'lastClr');
    if (last) return normalizeHex(last);
  }
  const prst = child(container, 'prstClr');
  if (prst) {
    const val = attr(prst, 'val');
    if (val) return normalizeHex(PRESET_COLORS[val.toLowerCase()] ?? '000000');
  }
  return undefined;
}

function applyModifiers(base: ThemeColor, el: Element): ThemeColor {
  // Alpha applies to every color kind (an OOXML producer can attach
  // `<a:alpha>` to srgb / scheme / sys / prst alike). Tint, shade,
  // lumMod, and lumOff are role-only — they recolor a theme slot,
  // which makes no sense for a literal sRGB value.
  const alpha = readAlpha(el);
  if (base.kind !== 'role') {
    return alpha != null ? { ...base, alpha } : base;
  }
  // tint / shade / lumMod / lumOff are OOXML thousandths (lumOff allows
  // negatives, the others are 0..100000); normalize to 0..1 at the
  // import boundary so `resolveColor` / `tintColor` / `shadeColor` can
  // apply them directly as ratios without re-scaling at every paint.
  let tint: number | undefined;
  let shade: number | undefined;
  let lumMod: number | undefined;
  let lumOff: number | undefined;
  const tEl = children(el, 'tint')[0];
  if (tEl) {
    const v = attrInt(tEl, 'val');
    if (v != null) tint = v / 100000;
  }
  const sEl = children(el, 'shade')[0];
  if (sEl) {
    const v = attrInt(sEl, 'val');
    if (v != null) shade = v / 100000;
  }
  const lmEl = children(el, 'lumMod')[0];
  if (lmEl) {
    const v = attrInt(lmEl, 'val');
    if (v != null) lumMod = v / 100000;
  }
  const loEl = children(el, 'lumOff')[0];
  if (loEl) {
    const v = attrInt(loEl, 'val');
    if (v != null) lumOff = v / 100000;
  }
  if (
    tint == null &&
    shade == null &&
    lumMod == null &&
    lumOff == null &&
    alpha == null
  ) {
    return base;
  }
  // Spread only the modifiers that were actually present; an
  // `alpha: undefined` key would break `toEqual` shape checks (and
  // serializes as `null` through some JSON pipelines).
  const out = { ...base };
  if (tint != null) out.tint = tint;
  if (shade != null) out.shade = shade;
  if (lumMod != null) out.lumMod = lumMod;
  if (lumOff != null) out.lumOff = lumOff;
  if (alpha != null) out.alpha = alpha;
  return out;
}

function normalizeHex(hex: string): string {
  const h = hex.startsWith('#') ? hex.slice(1) : hex;
  return '#' + h.toUpperCase();
}
