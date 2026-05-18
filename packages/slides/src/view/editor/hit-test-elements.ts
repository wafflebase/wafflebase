import type { Element } from '../../model/element';
import type { Slide } from '../../model/presentation';
import { containsPoint } from '../../model/frame';
import { applyInversePoint, groupToTransform } from '../../model/group';

export interface HitResult {
  /** The leaf-most element under the point. */
  elementId: string;
  /** Ancestor chain from slide root (outer-first) to the hit element (last). */
  ancestorPath: string[];
}

/**
 * Hit-test in world (slide-root) coordinates. Returns the leaf-most
 * element under (x, y), plus the chain of ancestor groups containing it,
 * or null if no element is hit.
 *
 * The full `ancestorPath` is exposed so that Task 8's drill-in selection
 * state machine can determine which group layer to enter without requiring
 * a second traversal.
 */
export function hitTestSlide(
  slide: Slide,
  x: number,
  y: number,
): HitResult | null {
  return hitTestRecursive(slide.elements, x, y, []);
}

function hitTestRecursive(
  elements: Element[],
  x: number,
  y: number,
  ancestors: string[],
): HitResult | null {
  // Iterate front-to-back (last in array is topmost z-order).
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];

    if (el.type === 'group') {
      // Transform the world point into the group's local coordinate space,
      // then recurse into children. Groups have no fill in v1 so the group
      // bbox itself is not treated as a hit surface.
      const t = groupToTransform(el);
      const local = applyInversePoint(x, y, t);
      const hit = hitTestRecursive(
        el.data.children,
        local.x,
        local.y,
        [...ancestors, el.id],
      );
      if (hit) return hit;
      continue;
    }

    if (containsPoint(el.frame, x, y)) {
      return { elementId: el.id, ancestorPath: [...ancestors, el.id] };
    }
  }

  return null;
}

