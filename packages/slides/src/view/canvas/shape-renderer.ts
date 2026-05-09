import type { ShapeElement } from '../../model/element';
import { resolveColor, type Theme } from '../../model/theme';
import { drawLine, drawArrow } from './shape-special';
import { PATH_BUILDERS } from './shapes';
import type { FrameSize } from './shapes/builder';

export type { FrameSize } from './shapes/builder';

const placeholderWarned = new Set<string>();

/**
 * Draw a shape into element-local coordinates (top-left at 0,0). The
 * caller is responsible for the frame transform (translate + rotate).
 *
 * line/arrow are special-cased (open path, two-tone arrow head). All
 * other kinds resolve through PATH_BUILDERS; unknown kinds fall back
 * to a placeholder rectangle so the slide always renders.
 */
export function drawShape(
  ctx: CanvasRenderingContext2D,
  size: FrameSize,
  data: ShapeElement['data'],
  theme: Theme,
): void {
  if (data.kind === 'line') return drawLine(ctx, size, data, theme);
  if (data.kind === 'arrow') return drawArrow(ctx, size, data, theme);

  const builder = PATH_BUILDERS.get(data.kind);
  if (!builder) {
    if (!placeholderWarned.has(data.kind)) {
      placeholderWarned.add(data.kind);
      console.warn(
        `slides: no path builder registered for shape kind "${data.kind}"; ` +
          `falling back to placeholder rect`,
      );
    }
    drawPlaceholderRect(ctx, size, data, theme);
    return;
  }
  const path = builder(size, data.adjustments);
  if (data.fill) {
    ctx.fillStyle = resolveColor(data.fill, theme);
    ctx.fill(path);
  }
  if (data.stroke) {
    ctx.strokeStyle = resolveColor(data.stroke.color, theme);
    ctx.lineWidth = data.stroke.width;
    ctx.stroke(path);
  }
}

function drawPlaceholderRect(
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
