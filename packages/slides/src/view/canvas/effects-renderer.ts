import type { DropShadow } from '../../model/element';
import type { Theme } from '../../model/theme';
import { resolveStrokeColor } from './render-context';

/**
 * Combine a resolved CSS/hex color with an opacity `[0, 1]` into an
 * `rgba(...)` string suitable for `ctx.shadowColor`. Handles `#rgb`,
 * `#rrggbb`, and `#rrggbbaa` hex inputs (the forms theme resolution
 * produces); any other CSS form is returned unchanged so the shadow
 * still paints, just without honoring the opacity field.
 */
export function colorWithAlpha(css: string, opacity: number): string {
  const a = Math.max(0, Math.min(1, opacity));
  if (css.startsWith('#')) {
    const hex = css.slice(1);
    let r: number;
    let g: number;
    let b: number;
    if (hex.length === 3) {
      r = parseInt(hex[0] + hex[0], 16);
      g = parseInt(hex[1] + hex[1], 16);
      b = parseInt(hex[2] + hex[2], 16);
    } else if (hex.length === 6 || hex.length === 8) {
      r = parseInt(hex.slice(0, 2), 16);
      g = parseInt(hex.slice(2, 4), 16);
      b = parseInt(hex.slice(4, 6), 16);
    } else {
      return css;
    }
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return css;
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  return css;
}

/**
 * Set the canvas shadow state from a {@link DropShadow}. The offset is
 * derived from polar `distance` / `angle` (OOXML `dist` / `dir`).
 * Applies in the element's local (already rotated/scaled) coordinate
 * space, so the shadow rotates with the shape — matching OOXML
 * `<a:outerShdw>` semantics where `dir` is shape-relative.
 *
 * Callers must pair this with {@link clearShadow} before painting any
 * content that should NOT cast the shadow (e.g. text drawn on top of a
 * shape's fill) — the element-level `ctx.save()/restore()` resets it
 * for the next element regardless.
 */
export function applyShadow(
  ctx: CanvasRenderingContext2D,
  shadow: DropShadow,
  theme: Theme,
): void {
  const css = resolveStrokeColor(shadow.color, theme);
  ctx.shadowColor = colorWithAlpha(css, shadow.opacity);
  ctx.shadowBlur = shadow.blur;
  ctx.shadowOffsetX = shadow.distance * Math.cos(shadow.angle);
  ctx.shadowOffsetY = shadow.distance * Math.sin(shadow.angle);
}

/** Reset the canvas shadow state so subsequent draws cast no shadow. */
export function clearShadow(ctx: CanvasRenderingContext2D): void {
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}
