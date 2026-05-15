// packages/slides/src/view/canvas/shape-special.ts
import type { ShapeElement } from '../../model/element';
import { resolveColor, type Theme, type ThemeColor } from '../../model/theme';
import { resolveStrokeColor } from './render-context';
import type { FrameSize } from './shapes/builder';
import { ACTION_BUTTON_GLYPHS } from './shapes/action-buttons';

const ACTION_BUTTON_BEVEL_INSET = 4;
const ACTION_BUTTON_GLYPH_FALLBACK: ThemeColor = { kind: 'role', role: 'text' };

/**
 * Paint an action button in two passes:
 *  1. Body — outer rectangle filled with `data.fill`, plus an
 *     `ACTION_BUTTON_BEVEL_INSET`-px inset bevel outline stroked
 *     with `data.stroke` to mimic the OOXML preset's beveled look
 *     (the inset is just a visual hint — the real beveled gradient
 *     is a P3-C follow-up).
 *  2. Glyph — per-kind inner icon from `ACTION_BUTTON_GLYPHS`,
 *     scaled by `min(w, h)` and filled with `role: 'text'` so
 *     icons remain legible against any body fill.
 */
export function drawActionButton(
  ctx: CanvasRenderingContext2D,
  { w, h }: FrameSize,
  data: ShapeElement['data'],
  theme: Theme,
): void {
  // Body fill.
  if (data.fill) {
    ctx.fillStyle = resolveColor(data.fill, theme);
    ctx.fillRect(0, 0, w, h);
  }
  // Outer + inner bevel outline.
  if (data.stroke) {
    ctx.strokeStyle = resolveStrokeColor(data.stroke.color, theme);
    ctx.lineWidth = data.stroke.width;
    ctx.strokeRect(0, 0, w, h);
    const inset = ACTION_BUTTON_BEVEL_INSET;
    if (w > 2 * inset && h > 2 * inset) {
      ctx.strokeRect(inset, inset, w - 2 * inset, h - 2 * inset);
    }
  }
  // Glyph. Inherits the stroke colour so the bevel outline + inner
  // glyph form a coherent two-tone visual. If the resolved glyph
  // colour collides with the body fill (e.g. the user explicitly set
  // `fill: text`), fall back to the background role so the glyph
  // stays legible. Without this guard a body fill of the same role
  // as the glyph fallback would paint an invisible icon.
  const glyphBuilder = ACTION_BUTTON_GLYPHS.get(data.kind);
  if (glyphBuilder) {
    const path = glyphBuilder({ w, h });
    const glyphSource = data.stroke?.color ?? ACTION_BUTTON_GLYPH_FALLBACK;
    // resolveStrokeColor is used here for its ThemeColor|string union handling, not because the glyph is stroked.
    const glyphResolved = resolveStrokeColor(glyphSource, theme);
    const bodyResolved = data.fill ? resolveColor(data.fill, theme) : null;
    ctx.fillStyle =
      bodyResolved === glyphResolved
        ? resolveColor({ kind: 'role', role: 'background' }, theme)
        : glyphResolved;
    ctx.fill(path);
  }
}
