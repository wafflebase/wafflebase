// packages/slides/src/view/canvas/shape-special.ts
import type { ShapeElement } from '../../model/element';
import { resolveColor, type Theme, type ThemeColor } from '../../model/theme';
import type { FrameSize } from './shapes/builder';

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
