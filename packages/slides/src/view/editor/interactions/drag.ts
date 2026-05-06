import type { Element } from '../../../model/element';

/**
 * Pure: apply a (dx, dy) translation to every element. Returns
 * deep-cloned elements so callers can pass the result through their
 * own state without worrying about input aliasing.
 */
export function applyDrag(
  elements: readonly Element[],
  dx: number, dy: number,
): Element[] {
  return elements.map((el) => ({
    ...el,
    frame: { ...el.frame, x: el.frame.x + dx, y: el.frame.y + dy },
  }));
}
