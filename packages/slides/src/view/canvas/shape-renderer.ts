import type { ShapeElement } from '../../model/element';
import { resolveColor, type Theme, type ThemeColor } from '../../model/theme';

export type FrameSize = { w: number; h: number };

/**
 * Draw a shape into element-local coordinates (top-left at 0,0). The
 * caller is responsible for the frame transform (translate + rotate).
 *
 * Every `ctx.fillStyle` / `ctx.strokeStyle` site goes through
 * `resolveColor(themeColor, theme)` so role-bound (palette) and srgb
 * (literal) colors share a single code path.
 */
export function drawShape(
  ctx: CanvasRenderingContext2D,
  size: FrameSize,
  data: ShapeElement['data'],
  theme: Theme,
): void {
  switch (data.kind) {
    case 'rect':
      drawRect(ctx, size, data, theme);
      return;
    case 'ellipse':
      drawEllipse(ctx, size, data, theme);
      return;
    case 'line':
      drawLine(ctx, size, data, theme);
      return;
    case 'arrow':
      drawArrow(ctx, size, data, theme);
      return;
  }
}

function drawRect(
  ctx: CanvasRenderingContext2D,
  { w, h }: FrameSize,
  data: ShapeElement['data'],
  theme: Theme,
): void {
  if (data.fill) {
    ctx.fillStyle = resolveColor(data.fill, theme);
    ctx.fillRect(0, 0, w, h);
  }
  if (data.stroke) {
    ctx.strokeStyle = resolveColor(data.stroke.color, theme);
    ctx.lineWidth = data.stroke.width;
    ctx.strokeRect(0, 0, w, h);
  }
}

function drawEllipse(
  ctx: CanvasRenderingContext2D,
  { w, h }: FrameSize,
  data: ShapeElement['data'],
  theme: Theme,
): void {
  ctx.beginPath();
  ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  if (data.fill) {
    ctx.fillStyle = resolveColor(data.fill, theme);
    ctx.fill();
  }
  if (data.stroke) {
    ctx.strokeStyle = resolveColor(data.stroke.color, theme);
    ctx.lineWidth = data.stroke.width;
    ctx.stroke();
  }
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  { w, h }: FrameSize,
  data: ShapeElement['data'],
  theme: Theme,
): void {
  if (!data.stroke) return; // A line with no stroke is invisible.
  ctx.strokeStyle = resolveColor(data.stroke.color, theme);
  ctx.lineWidth = data.stroke.width;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(w, h);
  ctx.stroke();
}

/**
 * Fallback head color used when an arrow has neither `fill` nor
 * `stroke` set. Bound to the theme's `text` role so the head still
 * paints in a visible, theme-appropriate ink rather than a hard-coded
 * `#000`.
 */
const ARROW_HEAD_FALLBACK: ThemeColor = { kind: 'role', role: 'text' };

function drawArrow(
  ctx: CanvasRenderingContext2D,
  { w, h }: FrameSize,
  data: ShapeElement['data'],
  theme: Theme,
): void {
  // Shaft
  if (data.stroke) {
    ctx.strokeStyle = resolveColor(data.stroke.color, theme);
    ctx.lineWidth = data.stroke.width;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(w, h);
    ctx.stroke();
  }
  // Head — a small filled triangle at the (w, h) tip, oriented along
  // the shaft direction. The head length scales with the smaller of
  // the frame's two dimensions so it stays visible at any frame
  // aspect ratio.
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

  const headColor: ThemeColor = data.fill ?? data.stroke?.color ?? ARROW_HEAD_FALLBACK;
  ctx.fillStyle = resolveColor(headColor, theme);
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(pLeft.x, pLeft.y);
  ctx.lineTo(pRight.x, pRight.y);
  ctx.closePath();
  ctx.fill();
}
