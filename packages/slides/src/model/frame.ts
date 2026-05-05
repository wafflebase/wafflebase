import type { Frame } from './element';

export type Point = { x: number; y: number };

/**
 * Hit-test a point against a frame, accounting for rotation around the
 * frame's center.
 */
export function containsPoint(frame: Frame, px: number, py: number): boolean {
  const local = toLocal(frame, { x: px, y: py });
  return (
    local.x >= 0 &&
    local.x <= frame.w &&
    local.y >= 0 &&
    local.y <= frame.h
  );
}

/**
 * Convert a point from world (slide) coordinates into the frame's local
 * coordinates, where (0,0) is the top-left corner of the un-rotated
 * frame.
 */
export function toLocal(frame: Frame, p: Point): Point {
  const cx = frame.x + frame.w / 2;
  const cy = frame.y + frame.h / 2;
  const rx = p.x - cx;
  const ry = p.y - cy;
  // Rotate by -rotation to undo the element's rotation.
  const cos = Math.cos(-frame.rotation);
  const sin = Math.sin(-frame.rotation);
  const lx = rx * cos - ry * sin;
  const ly = rx * sin + ry * cos;
  return { x: lx + frame.w / 2, y: ly + frame.h / 2 };
}

/** Bounding box of a (possibly rotated) frame, in world coordinates. */
export function boundingBox(frame: Frame): {
  x: number; y: number; w: number; h: number;
} {
  if (frame.rotation === 0) {
    return { x: frame.x, y: frame.y, w: frame.w, h: frame.h };
  }
  const corners = frameCorners(frame);
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Smallest axis-aligned bbox enclosing multiple frames. */
export function combinedBoundingBox(frames: Frame[]): {
  x: number; y: number; w: number; h: number;
} | undefined {
  if (frames.length === 0) return undefined;
  const boxes = frames.map(boundingBox);
  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxX = Math.max(...boxes.map((b) => b.x + b.w));
  const maxY = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function frameCorners(frame: Frame): Point[] {
  const cx = frame.x + frame.w / 2;
  const cy = frame.y + frame.h / 2;
  const cos = Math.cos(frame.rotation);
  const sin = Math.sin(frame.rotation);
  const rotate = (lx: number, ly: number): Point => {
    const dx = lx - frame.w / 2;
    const dy = ly - frame.h / 2;
    return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
  };
  return [
    rotate(0, 0),
    rotate(frame.w, 0),
    rotate(frame.w, frame.h),
    rotate(0, frame.h),
  ];
}
