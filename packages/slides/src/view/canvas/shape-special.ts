// packages/slides/src/view/canvas/shape-special.ts
import type { ShapeElement } from '../../model/element';
import { resolveColor, type Theme, type ThemeColor } from '../../model/theme';
import type { FrameSize } from './shapes/builder';
import { ACTION_BUTTON_GLYPHS } from './shapes/action-buttons';

export function drawLine(
  ctx: CanvasRenderingContext2D,
  { w, h }: FrameSize,
  data: ShapeElement['data'],
  theme: Theme,
): void {
  if (!data.stroke) return;
  ctx.strokeStyle = resolveColor(data.stroke.color, theme);
  ctx.lineWidth = data.stroke.width;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(w, h);
  ctx.stroke();
}

const ARROW_HEAD_FALLBACK: ThemeColor = { kind: 'role', role: 'text' };

export function drawArrow(
  ctx: CanvasRenderingContext2D,
  { w, h }: FrameSize,
  data: ShapeElement['data'],
  theme: Theme,
): void {
  if (data.stroke) {
    ctx.strokeStyle = resolveColor(data.stroke.color, theme);
    ctx.lineWidth = data.stroke.width;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(w, h);
    ctx.stroke();
  }
  const tip = { x: w, y: h };
  const headLen = Math.min(w, h, 40) * 0.4;
  const angle = Math.atan2(h, w);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const baseCx = tip.x - headLen * cos;
  const baseCy = tip.y - headLen * sin;
  const half = headLen * 0.5;
  const pLeft = { x: baseCx - half * sin, y: baseCy + half * cos };
  const pRight = { x: baseCx + half * sin, y: baseCy - half * cos };

  const headColor: ThemeColor =
    data.fill ?? data.stroke?.color ?? ARROW_HEAD_FALLBACK;
  ctx.fillStyle = resolveColor(headColor, theme);
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(pLeft.x, pLeft.y);
  ctx.lineTo(pRight.x, pRight.y);
  ctx.closePath();
  ctx.fill();
}

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
    ctx.strokeStyle = resolveColor(data.stroke.color, theme);
    ctx.lineWidth = data.stroke.width;
    ctx.strokeRect(0, 0, w, h);
    const inset = ACTION_BUTTON_BEVEL_INSET;
    if (w > 2 * inset && h > 2 * inset) {
      ctx.strokeRect(inset, inset, w - 2 * inset, h - 2 * inset);
    }
  }
  // Glyph.
  const glyphBuilder = ACTION_BUTTON_GLYPHS.get(data.kind);
  if (glyphBuilder) {
    const path = glyphBuilder({ w, h });
    ctx.fillStyle = resolveColor(
      data.stroke?.color ?? ACTION_BUTTON_GLYPH_FALLBACK,
      theme,
    );
    ctx.fill(path);
  }
}
