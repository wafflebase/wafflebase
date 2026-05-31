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
export type ThemeColor =
  | { kind: 'role'; role: ColorRole; tint?: number; shade?: number; alpha?: number }
  | { kind: 'srgb'; value: string; alpha?: number };

export type ThemeFont =
  | { kind: 'role'; role: FontRole }
  | { kind: 'family'; family: string };

export function resolveColor(color: ThemeColor, theme: Theme): string {
  let hex: string;
  if (color.kind === 'srgb') {
    hex = color.value;
  } else {
    const base = theme.colors[color.role];
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

function hexToRgba(hex: string, alpha: number): string {
  const [r, g, b] = parseHex(hex);
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
