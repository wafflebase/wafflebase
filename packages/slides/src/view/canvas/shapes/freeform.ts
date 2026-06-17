// packages/slides/src/view/canvas/shapes/freeform.ts
import type { FreeformPath } from '../../../model/element';
import type { FrameSize } from './builder';

/**
 * Build a `Path2D` for a freeform (OOXML `<a:custGeom>`) shape.
 *
 * Unlike the parametric `PathBuilder`s, freeform geometry is data-driven:
 * the commands are stored normalized to `[0, 1]` of the source path's
 * viewBox, so we simply scale each coordinate by the frame size. The
 * result is in element-local coordinates (top-left at 0,0), matching every
 * other shape path — the caller owns fill/stroke/theme just like
 * `drawShape` does for parametric kinds.
 *
 * Arc commands are emitted with anisotropic radii (`rx*w`, `ry*h`); since
 * the centre is derived from the segment's start point at parse time, the
 * arc joins the current point without a spurious connecting line.
 */
export function buildFreeformPath(
  { w, h }: FrameSize,
  path: FreeformPath,
): Path2D {
  const p = new Path2D();
  for (const cmd of path.commands) {
    switch (cmd.c) {
      case 'M':
        p.moveTo(cmd.x * w, cmd.y * h);
        break;
      case 'L':
        p.lineTo(cmd.x * w, cmd.y * h);
        break;
      case 'Q':
        p.quadraticCurveTo(cmd.x1 * w, cmd.y1 * h, cmd.x * w, cmd.y * h);
        break;
      case 'C':
        p.bezierCurveTo(
          cmd.x1 * w,
          cmd.y1 * h,
          cmd.x2 * w,
          cmd.y2 * h,
          cmd.x * w,
          cmd.y * h,
        );
        break;
      case 'A':
        p.ellipse(
          cmd.cx * w,
          cmd.cy * h,
          cmd.rx * w,
          cmd.ry * h,
          0,
          cmd.start,
          cmd.start + cmd.sweep,
          cmd.sweep < 0,
        );
        break;
      case 'Z':
        p.closePath();
        break;
    }
  }
  return p;
}
