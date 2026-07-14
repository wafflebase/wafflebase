import type { Slide } from '../../../model/presentation';
import { boundingBox } from '../../../model/frame';
import { normalizeRect, rectsIntersect, type Rect } from '@wafflebase/core/geometry';

export { normalizeRect };
export type { Rect };

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
