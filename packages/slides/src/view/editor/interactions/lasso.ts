import type { Slide } from '../../../model/presentation';
import { boundingBox } from '../../../model/frame';

export interface Rect {
  x: number; y: number; w: number; h: number;
}

/**
 * Normalise a rectangle from two arbitrary corner points so that w/h
 * are non-negative. Used while the user is dragging — startX/startY
 * stay fixed, currentX/currentY can move in any direction.
 */
export function normalizeRect(
  startX: number, startY: number,
  currentX: number, currentY: number,
): Rect {
  const x = Math.min(startX, currentX);
  const y = Math.min(startY, currentY);
  const w = Math.abs(currentX - startX);
  const h = Math.abs(currentY - startY);
  return { x, y, w, h };
}

/**
 * Return ids of elements whose axis-aligned bounding box intersects
 * `rect`. Edge contact counts as intersection, matching how Google
 * Slides behaves (and the spec's "bbox intersects" wording).
 */
export function selectInRect(slide: Slide, rect: Rect): string[] {
  const ids: string[] = [];
  for (const el of slide.elements) {
    const bb = boundingBox(el.frame);
    if (rectsIntersect(bb, rect)) ids.push(el.id);
  }
  return ids;
}

function rectsIntersect(a: Rect, b: Rect): boolean {
  return !(
    a.x + a.w < b.x ||
    b.x + b.w < a.x ||
    a.y + a.h < b.y ||
    b.y + b.h < a.y
  );
}
