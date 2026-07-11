import type { Stroke } from '../../model/element';
import type { SlidesDocument } from '../../model/presentation';
import {
  representativeColor,
  resolveColor,
  type Fill,
  type Theme,
  type ThemeColor,
} from '../../model/theme';

/**
 * Resolve a shape {@link Fill} to a canvas `fillStyle` value: a CSS color
 * string for a solid `ThemeColor`, or a `CanvasGradient` for a linear
 * gradient. The gradient is laid out across the element's local `w × h`
 * box (painters draw in local coords) along `fill.angle`, so the caller
 * must pass the shape's frame size. A degenerate gradient (0 or 1 stop)
 * falls back to the single representative color so nothing paints
 * transparent.
 */
export function resolveFillStyle(
  ctx: CanvasRenderingContext2D,
  fill: Fill,
  theme: Theme,
  w: number,
  h: number,
): string | CanvasGradient {
  if (fill.kind !== 'gradient') return resolveColor(fill, theme);
  const stops = fill.stops;
  // Center the gradient axis and extend it so the box's corners project
  // onto [start, end] — matches how CSS/PowerPoint span a linear gradient
  // across the whole rectangle regardless of angle.
  const cx = w / 2;
  const cy = h / 2;
  const dx = Math.cos(fill.angle);
  const dy = Math.sin(fill.angle);
  const half = (Math.abs(dx) * w + Math.abs(dy) * h) / 2;
  // Degenerate cases — fewer than two stops, or a zero-length axis (a 0×0
  // box, e.g. mid insert-drag) — can't form a blend; paint the
  // representative solid so nothing renders a single-stop / empty gradient.
  if (stops.length < 2 || half === 0) {
    return resolveColor(representativeColor(fill), theme);
  }
  const grad = ctx.createLinearGradient(cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half);
  for (const s of stops) {
    grad.addColorStop(Math.max(0, Math.min(1, s.pos)), resolveColor(s.color, theme));
  }
  return grad;
}

/**
 * Resolve a stroke color that may be either a legacy ThemeColor discriminated
 * union (stored in older Yorkie documents) or a plain CSS/hex string (produced
 * by the toolbar redesign and all new editing paths).
 */
export function resolveStrokeColor(color: Stroke['color'], theme: Theme): string {
  if (typeof color === 'string') return color;
  return resolveColor(color as ThemeColor, theme);
}

/**
 * Map a stroke dash style to a canvas line-dash array. Shared by the
 * text-box and table renderers so dashed / dotted strokes look identical
 * across surfaces. Absent / `'solid'` ⇒ a continuous line.
 */
export function dashArray(dash: Stroke['dash']): number[] {
  if (dash === 'dashed') return [6, 4];
  if (dash === 'dotted') return [2, 2];
  return [];
}

/**
 * Render-time context bundle threaded through every canvas painter so
 * each `ctx.fillStyle` / `ctx.strokeStyle` site can resolve a
 * `ThemeColor` against the deck's active theme. Currently a thin pair;
 * Task 4 widens this to also carry a `colorResolver` for the docs
 * text path.
 */
export type RenderContext = {
  doc: SlidesDocument;
  theme: Theme;
};

/**
 * Resolve the deck's active theme by `meta.themeId`. Throws when the
 * id doesn't match any entry in `doc.themes` — a misconfigured
 * SlidesDocument is a programmer error, not a runtime fallback.
 */
export function getActiveTheme(doc: SlidesDocument): Theme {
  const t = doc.themes.find((x) => x.id === doc.meta.themeId);
  if (!t) {
    throw new Error(
      `[slides] active theme '${doc.meta.themeId}' not found in document; ` +
        `themes: ${doc.themes.map((x) => x.id).join(', ') || '(none)'}`,
    );
  }
  return t;
}
