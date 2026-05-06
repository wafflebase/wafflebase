import type { Slide } from '../../../model/presentation';
import { containsPoint } from '../../../model/frame';

export interface SelectModifiers {
  shift?: boolean;
}

/**
 * Compute the new selection when the user clicks at logical-slide
 * coordinates `(x, y)`.
 *
 * Hit-testing iterates from last to first so the topmost (front) element
 * wins for overlapping shapes — matches the array-order = z-order
 * convention.
 */
export function selectAt(
  slide: Slide,
  x: number, y: number,
  mods: SelectModifiers,
  current: readonly string[],
): string[] {
  const hit = topmostUnderPoint(slide, x, y);

  if (mods.shift) {
    if (hit === null) return [...current]; // shift on empty: no-op
    return toggleId(current, hit);
  }

  if (hit === null) return [];
  return [hit];
}

function topmostUnderPoint(slide: Slide, x: number, y: number): string | null {
  for (let i = slide.elements.length - 1; i >= 0; i--) {
    if (containsPoint(slide.elements[i].frame, x, y)) {
      return slide.elements[i].id;
    }
  }
  return null;
}

function toggleId(ids: readonly string[], id: string): string[] {
  const i = ids.indexOf(id);
  if (i === -1) return [...ids, id];
  return [...ids.slice(0, i), ...ids.slice(i + 1)];
}
