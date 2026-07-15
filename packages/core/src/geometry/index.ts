/**
 * Shared 2-D geometry primitives.
 *
 * These type aliases were previously redefined ad-hoc across the engine
 * packages (five copies of `Point`/`Rect`/`Size` inside `slides` alone).
 * The canonical convention is `{ x, y }` for points and `{ x, y, w, h }`
 * for rectangles — matching the slides model, which has by far the most
 * geometry usage. Model-bound helpers that depend on a package's own
 * element/frame type (e.g. rotation-aware hit-testing) stay in that
 * package; only pure, model-agnostic math lives here.
 */

/** A point in 2-D space. */
export type Point = { x: number; y: number };

/** A width/height pair. */
export type Size = { w: number; h: number };

/** An axis-aligned rectangle: top-left corner plus size. */
export type Rect = { x: number; y: number; w: number; h: number };

/**
 * Normalise a rectangle from two arbitrary corner points so that `w`/`h`
 * are non-negative. Used while dragging — the start corner stays fixed
 * while the current corner can move in any direction.
 */
export function normalizeRect(
  startX: number,
  startY: number,
  currentX: number,
  currentY: number,
): Rect {
  return {
    x: Math.min(startX, currentX),
    y: Math.min(startY, currentY),
    w: Math.abs(currentX - startX),
    h: Math.abs(currentY - startY),
  };
}

/**
 * True iff two axis-aligned rectangles overlap. Edge contact counts as
 * intersection, matching Google Slides' lasso-select behaviour.
 */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return !(
    a.x + a.w < b.x ||
    b.x + b.w < a.x ||
    a.y + a.h < b.y ||
    b.y + b.h < a.y
  );
}

/**
 * The smallest axis-aligned rectangle enclosing every input rectangle,
 * or `undefined` when the list is empty.
 */
export function unionRect(rects: readonly Rect[]): Rect | undefined {
  if (rects.length === 0) return undefined;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    if (r.x < minX) minX = r.x;
    if (r.y < minY) minY = r.y;
    if (r.x + r.w > maxX) maxX = r.x + r.w;
    if (r.y + r.h > maxY) maxY = r.y + r.h;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
