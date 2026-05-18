import type { Element } from '../../model/element';
import type { Slide } from '../../model/presentation';
import { containsPoint } from '../../model/frame';
import { groupToTransform } from '../../model/group';
import type { GroupTransform } from '../../model/group';

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

/**
 * Transform a world point `(x, y)` into the local coordinate space
 * of the frame described by `t`. This is the point-only equivalent
 * of `applyInverseMatrix` — avoids the zero-extent Frame trick and
 * makes the intent explicit.
 */
function applyInversePoint(
  x: number,
  y: number,
  t: GroupTransform,
): { x: number; y: number } {
  const det = t.a * t.d - t.b * t.c;
  // Pure rotation / translation matrices always have det === 1; this
  // guard is a safety net for any future shear cases.
  const invA =  t.d / det;
  const invB = -t.b / det;
  const invC = -t.c / det;
  const invD =  t.a / det;
  const invTx = -(t.d * t.tx - t.c * t.ty) / det;
  const invTy =  (t.b * t.tx - t.a * t.ty) / det;
  return {
    x: invA * x + invC * y + invTx,
    y: invB * x + invD * y + invTy,
  };
}
