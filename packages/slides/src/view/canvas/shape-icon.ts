import type { ShapeKind } from '../../model/element';
import type { FrameSize } from './shapes/builder';
import { PATH_BUILDERS } from './shapes';

const STROKE_WIDTH = 1.5;
const PADDING = 1;

/**
 * Paint a shape outline at icon size into the supplied context. Used
 * by the toolbar's Shape ▾ picker so previews track geometry from
 * `PATH_BUILDERS` without a separate icon asset. Caller is expected to
 * have set `ctx.strokeStyle` to currentColor (or the desired colour)
 * before calling. `line`/`arrow` are special-cased to a simple
 * diagonal / arrow glyph for the picker; their canvas-time renderers
 * are intentionally not reused (those paint with theme fills tied to
 * frame size, which would not show up at picker scale).
 */
export function renderShapeIcon(
  kind: ShapeKind,
  ctx: CanvasRenderingContext2D,
  size: FrameSize,
): void {
  const inset = PADDING + STROKE_WIDTH / 2;
  const w = Math.max(0, size.w - inset * 2);
  const h = Math.max(0, size.h - inset * 2);
  ctx.save();
  try {
    ctx.translate(inset, inset);
    ctx.lineWidth = STROKE_WIDTH;
    ctx.lineJoin = 'round';
    if (kind === 'line') {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(w, h);
      ctx.stroke();
      return;
    }
    if (kind === 'arrow') {
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w * 0.75, h / 2);
      ctx.moveTo(w * 0.55, h * 0.25);
      ctx.lineTo(w * 0.75, h / 2);
      ctx.lineTo(w * 0.55, h * 0.75);
      ctx.stroke();
      return;
    }
    const builder = PATH_BUILDERS.get(kind);
    if (!builder) return;
    const path = builder({ w, h }, undefined);
    ctx.stroke(path);
  } finally {
    ctx.restore();
  }
}
