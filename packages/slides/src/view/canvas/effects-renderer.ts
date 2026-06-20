import type { DropShadow, Reflection } from '../../model/element';
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

/**
 * Allocate a same-document `<canvas>` for the offscreen reflection pass.
 * Returns `null` when no DOM / 2D context is available (Node, or the
 * jsdom test env without the `canvas` package) so callers can skip the
 * reflection gracefully rather than crash.
 */
function createOffscreen(
  w: number,
  h: number,
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(w));
  canvas.height = Math.max(1, Math.ceil(h));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  return { canvas, ctx };
}

/**
 * Paint a fading mirror of the element below it. Mirrors OOXML
 * `<a:reflection>`: the copy is most opaque at the element's bottom
 * edge (`reflection.opacity`) and fades to transparent over
 * `reflection.size × h`, offset down by `reflection.distance`.
 *
 * The body is rendered to an offscreen canvas in element-local
 * coordinates, faded with a `destination-out` gradient, then drawn
 * vertically flipped beneath the element. No-op when the offscreen
 * canvas is unavailable (Node / jsdom).
 */
export function paintReflection(
  ctx: CanvasRenderingContext2D,
  size: { w: number; h: number },
  reflection: Reflection,
  paintBody: (target: CanvasRenderingContext2D) => void,
): void {
  const { w, h } = size;
  if (w <= 0 || h <= 0) return;
  const fade = Math.max(0, Math.min(1, reflection.size)) * h;
  if (fade <= 0) return;

  const off = createOffscreen(w, h);
  if (!off) return;

  // 1) Render the element body into the offscreen, in local coords.
  paintBody(off.ctx);

  // 2) Fade: keep the bottom edge (y = h, adjacent to the element once
  //    mirrored), erase toward the top over `fade` px. The gradient
  //    clamps to its end color above `h - fade`, fully erasing the far
  //    part of the reflection.
  off.ctx.globalCompositeOperation = 'destination-out';
  const grad = off.ctx.createLinearGradient(0, h, 0, Math.max(0, h - fade));
  grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 1)');
  off.ctx.fillStyle = grad;
  off.ctx.fillRect(0, 0, w, h);

  // 3) Draw the faded copy vertically flipped, just below the element.
  ctx.save();
  // The reflection is a pure mirrored/faded copy. The caller may still
  // have a drop shadow active on `ctx` (the text / image branches apply
  // it before reaching here), and `drawImage` would otherwise cast that
  // shadow onto the reflection bitmap. Clear it defensively so reflection
  // never inherits the element's shadow, regardless of call site.
  clearShadow(ctx);
  ctx.globalAlpha = Math.max(0, Math.min(1, reflection.opacity));
  ctx.translate(0, h + reflection.distance);
  ctx.scale(1, -1);
  ctx.translate(0, -h);
  ctx.drawImage(off.canvas, 0, 0, w, h);
  ctx.restore();
}
