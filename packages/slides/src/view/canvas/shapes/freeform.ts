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

/** A point in element-local coordinates. */
export type FlatPoint = { x: number; y: number };

/** Chord segments per curve when flattening (`Q` / `C` / `A`). */
const FLATTEN_STEPS = 12;

/**
 * Flatten a freeform path into polylines in element-local coordinates,
 * one per subpath: the geometry `buildFreeformPath` strokes, as straight
 * chords. A closed subpath (`Z`) repeats its first point.
 *
 * Pure (no `Path2D`), so hit-testing a stroke against its own line and
 * the eraser (`view/editor/freeform-hit.ts`) need no canvas context and
 * give the same answer in a test as in the browser.
 */
export function flattenFreeformPath(
  { w, h }: FrameSize,
  path: FreeformPath,
): FlatPoint[][] {
  const out: FlatPoint[][] = [];
  let cur: FlatPoint[] = [];
  let pen: FlatPoint = { x: 0, y: 0 };
  let start: FlatPoint = pen;
  const flush = (): void => {
    if (cur.length > 0) out.push(cur);
    cur = [];
  };
  const ensure = (): void => {
    if (cur.length === 0) cur.push(pen);
  };
  for (const cmd of path.commands) {
    switch (cmd.c) {
      case 'M':
        flush();
        pen = { x: cmd.x * w, y: cmd.y * h };
        start = pen;
        cur.push(pen);
        break;
      case 'L':
        ensure();
        pen = { x: cmd.x * w, y: cmd.y * h };
        cur.push(pen);
        break;
      case 'Q': {
        ensure();
        const p0 = pen;
        const c = { x: cmd.x1 * w, y: cmd.y1 * h };
        const p1 = { x: cmd.x * w, y: cmd.y * h };
        for (let i = 1; i <= FLATTEN_STEPS; i++) {
          const t = i / FLATTEN_STEPS;
          const u = 1 - t;
          cur.push({
            x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x,
            y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y,
          });
        }
        pen = p1;
        break;
      }
      case 'C': {
        ensure();
        const p0 = pen;
        const c1 = { x: cmd.x1 * w, y: cmd.y1 * h };
        const c2 = { x: cmd.x2 * w, y: cmd.y2 * h };
        const p1 = { x: cmd.x * w, y: cmd.y * h };
        for (let i = 1; i <= FLATTEN_STEPS; i++) {
          const t = i / FLATTEN_STEPS;
          const u = 1 - t;
          const a = u * u * u;
          const b = 3 * u * u * t;
          const c = 3 * u * t * t;
          const d = t * t * t;
          cur.push({
            x: a * p0.x + b * c1.x + c * c2.x + d * p1.x,
            y: a * p0.y + b * c1.y + c * c2.y + d * p1.y,
          });
        }
        pen = p1;
        break;
      }
      case 'A': {
        // Mirrors `buildFreeformPath`'s `ellipse(...)`: the canvas joins
        // the pen to the arc start with a line, then draws the arc.
        const cx = cmd.cx * w;
        const cy = cmd.cy * h;
        const rx = cmd.rx * w;
        const ry = cmd.ry * h;
        const steps = Math.max(
          FLATTEN_STEPS,
          Math.ceil((Math.abs(cmd.sweep) / (Math.PI / 2)) * FLATTEN_STEPS),
        );
        ensure();
        for (let i = 0; i <= steps; i++) {
          const a = cmd.start + (cmd.sweep * i) / steps;
          cur.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
        }
        pen = cur[cur.length - 1];
        break;
      }
      case 'Z':
        if (cur.length > 0) cur.push(start);
        flush();
        pen = start;
        break;
    }
  }
  flush();
  return out;
}
