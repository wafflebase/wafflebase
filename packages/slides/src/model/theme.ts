export type ColorScheme = {
  text: string;            // OOXML dk1
  background: string;      // OOXML lt1
  textSecondary: string;   // OOXML dk2
  backgroundAlt: string;   // OOXML lt2
  accent1: string;
  accent2: string;
  accent3: string;
  accent4: string;
  accent5: string;
  accent6: string;
  hyperlink: string;
  visitedHyperlink: string;
};

export type FontScheme = {
  heading: string;
  body: string;
};

export type Theme = {
  id: string;
  name: string;
  colors: ColorScheme;
  fonts: FontScheme;
};

export type ColorRole = keyof ColorScheme;
export type FontRole = keyof FontScheme;

/**
 * Optional `alpha` modifier on a color. Range: `0..1`, with
 * `undefined` ⇒ fully opaque (preserves the pre-alpha behavior — every
 * stored color without this field renders as it did before alpha
 * support landed). Values are clamped to `[0, 1]` at resolve time so
 * out-of-range data from buggy producers can't produce nonsense CSS.
 *
 * OOXML's `<a:alpha val>` is in thousandths (`0..100000`); the
 * importer normalizes to this `0..1` range so the renderer can use the
 * value directly as a CSS alpha multiplier.
 */
/**
 * `lumMod` / `lumOff` modifiers shift the role color in HSL space —
 * `L ← clamp(L * lumMod + lumOff, 0, 1)`. Both stored as 0..1 ratios
 * (the importer normalizes from OOXML thousandths). PowerPoint applies
 * them BEFORE tint/shade in the resolve order. Common pattern in real
 * decks: `<a:schemeClr val="bg1"><a:lumMod val="95000"/>` for a light
 * gray derived from white.
 */
export type ThemeColor =
  | {
      kind: 'role';
      role: ColorRole;
      lumMod?: number;
      lumOff?: number;
      tint?: number;
      shade?: number;
      alpha?: number;
    }
  | { kind: 'srgb'; value: string; alpha?: number };

export type ThemeFont =
  | { kind: 'role'; role: FontRole }
  | { kind: 'family'; family: string };

export function resolveColor(color: ThemeColor, theme: Theme): string {
  let hex: string;
  if (color.kind === 'srgb') {
    hex = color.value;
  } else {
    let base = theme.colors[color.role];
    if (color.lumMod != null || color.lumOff != null) {
      base = applyLumModOff(base, color.lumMod, color.lumOff);
    }
    if (color.tint != null) hex = tintColor(base, color.tint);
    else if (color.shade != null) hex = shadeColor(base, color.shade);
    else hex = base;
  }
  // Fast path: no alpha or fully opaque ⇒ return the hex verbatim so
  // existing callers (color pickers, CSS values, etc.) keep seeing the
  // same string they did before alpha support landed.
  if (color.alpha == null || color.alpha >= 1) return hex;
  return hexToRgba(hex, color.alpha);
}

export function resolveFont(font: ThemeFont, theme: Theme): string {
  if (font.kind === 'family') return font.family;
  return theme.fonts[font.role];
}

/**
 * Apply a signed luminance delta to an already-resolved CSS color
 * (`#RRGGBB` or `rgba(...)`). `delta > 0` lightens toward white,
 * `delta < 0` darkens toward black, `0` is identity. Used to paint the
 * differently-shaded faces of 3D-look shapes (cube/bevel/ribbon/scroll)
 * from a single base fill. Alpha (in `rgba(...)`) is preserved.
 */
export function applyShade(css: string, delta: number): string {
  if (delta === 0) return css;
  if (css.startsWith('#')) {
    return delta > 0 ? tintColor(css, delta) : shadeColor(css, -delta);
  }
  const m = /^rgba?\(([^)]+)\)/.exec(css);
  if (!m) return css;
  const parts = m[1].split(',').map((s) => s.trim());
  const r = Number(parts[0]);
  const g = Number(parts[1]);
  const b = Number(parts[2]);
  const a = parts[3] ?? '1';
  const f =
    delta > 0
      ? (v: number) => v + (255 - v) * delta
      : (v: number) => v * (1 + delta);
  const cl = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `rgba(${cl(f(r))}, ${cl(f(g))}, ${cl(f(b))}, ${a})`;
}

// Helpers — tint blends toward white, shade blends toward black.

function parseHex(hex: string): [number, number, number] {
  const h = hex.startsWith('#') ? hex.slice(1) : hex;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function toHex(r: number, g: number, b: number): string {
  const c = (v: number) => roundHalfToEven(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}

// Round half to even (banker's rounding). Matches IEEE 754 default and
// keeps tint/shade symmetric: tint(0.5) of 255 lands on the even neighbor
// (128), shade(0.5) of 153 lands on the even neighbor (76).
function roundHalfToEven(v: number): number {
  const floor = Math.floor(v);
  const diff = v - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

function tintColor(hex: string, ratio: number): string {
  const [r, g, b] = parseHex(hex);
  return toHex(r + (255 - r) * ratio, g + (255 - g) * ratio, b + (255 - b) * ratio);
}

function shadeColor(hex: string, ratio: number): string {
  const [r, g, b] = parseHex(hex);
  return toHex(r * (1 - ratio), g * (1 - ratio), b * (1 - ratio));
}

/**
 * Shift `hex` in HSL space: `L ← clamp(L * lumMod + lumOff, 0, 1)`.
 * Matches OOXML `<a:lumMod>` / `<a:lumOff>` semantics (per ECMA-376
 * § 20.1.2.3): luminance modulation runs in HSL, not RGB, so the hue
 * and saturation of the role color are preserved. Either operand may
 * be undefined; defaults are `lumMod=1` (identity) and `lumOff=0`.
 */
function applyLumModOff(
  hex: string,
  lumMod: number | undefined,
  lumOff: number | undefined,
): string {
  const [r, g, b] = parseHex(hex);
  const [h, s, l] = rgbToHsl(r, g, b);
  const newL = Math.max(0, Math.min(1, l * (lumMod ?? 1) + (lumOff ?? 0)));
  const [nr, ng, nb] = hslToRgb(h, s, newL);
  return toHex(nr, ng, nb);
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = l * 255;
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hueToRgb = (t: number): number => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [
    hueToRgb(h + 1 / 3) * 255,
    hueToRgb(h) * 255,
    hueToRgb(h - 1 / 3) * 255,
  ];
}

function hexToRgba(hex: string, alpha: number): string {
  const [r, g, b] = parseHex(hex);
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
