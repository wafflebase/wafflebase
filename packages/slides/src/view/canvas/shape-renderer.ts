import type { ShapeElement } from '../../model/element';

export type FrameSize = { w: number; h: number };

/**
 * Draw a shape into element-local coordinates (top-left at 0,0). The
 * caller is responsible for the frame transform (translate + rotate).
 */
export function drawShape(
  ctx: CanvasRenderingContext2D,
  size: FrameSize,
  data: ShapeElement['data'],
): void {
  switch (data.kind) {
    case 'rect':
      drawRect(ctx, size, data);
      return;
    case 'ellipse':
      drawEllipse(ctx, size, data);
      return;
    case 'line':
      drawLine(ctx, size, data);
      return;
    case 'arrow':
      drawArrow(ctx, size, data);
      return;
  }
}

function drawRect(
  ctx: CanvasRenderingContext2D,
  { w, h }: FrameSize,
  data: ShapeElement['data'],
): void {
  if (data.fill) {
    ctx.fillStyle = data.fill;
    ctx.fillRect(0, 0, w, h);
  }
  if (data.stroke) {
    ctx.strokeStyle = data.stroke.color;
    ctx.lineWidth = data.stroke.width;
    ctx.strokeRect(0, 0, w, h);
  }
}

function drawEllipse(
  ctx: CanvasRenderingContext2D,
  { w, h }: FrameSize,
  data: ShapeElement['data'],
): void {
  ctx.beginPath();
  ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  if (data.fill) {
    ctx.fillStyle = data.fill;
    ctx.fill();
  }
  if (data.stroke) {
    ctx.strokeStyle = data.stroke.color;
    ctx.lineWidth = data.stroke.width;
    ctx.stroke();
  }
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  { w, h }: FrameSize,
  data: ShapeElement['data'],
): void {
  if (!data.stroke) return; // A line with no stroke is invisible.
  ctx.strokeStyle = data.stroke.color;
  ctx.lineWidth = data.stroke.width;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(w, h);
  ctx.stroke();
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  { w, h }: FrameSize,
  data: ShapeElement['data'],
): void {
  // Shaft
  if (data.stroke) {
    ctx.strokeStyle = data.stroke.color;
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

  ctx.fillStyle = data.fill ?? data.stroke?.color ?? '#000';
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(pLeft.x, pLeft.y);
  ctx.lineTo(pRight.x, pRight.y);
  ctx.closePath();
  ctx.fill();
}
