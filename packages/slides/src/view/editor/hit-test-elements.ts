import type { Element } from '../../model/element';
import type { Slide } from '../../model/presentation';
import { applyInversePoint, groupToTransform } from '../../model/group';
import {
  DEFAULT_HIT_TOLERANCE,
  hitTestElement,
  type HitTestCtx,
} from './element-hit';

export interface HitResult {
  /** The leaf-most element under the point. */
  elementId: string;
  /** Ancestor chain from slide root (outer-first) to the hit element (last). */
  ancestorPath: string[];
}

/**
 * Caller-supplied context for the per-element precise hit-test
 * (`isPointInPath` + `isPointInStroke`). The 2D context is reused
 * from the slide renderer; tolerance defaults to
 * {@link DEFAULT_HIT_TOLERANCE} in slide-logical pixels.
 */
export interface HitTestSlideOptions {
  ctx: HitTestCtx;
  tolerance?: number;
}

/**
 * Hit-test in world (slide-root) coordinates. Returns the leaf-most
 * element under (x, y), plus the chain of ancestor groups containing it,
 * or null if no element is hit.
 *
 * The full `ancestorPath` is exposed so that the drill-in selection
 * state machine can determine which group layer to enter without
 * requiring a second traversal.
 *
 * Leaf elements are tested against their drawn geometry — filled shapes
 * via `ctx.isPointInPath` against the Path2D from `PATH_BUILDERS`, with
 * an `isPointInStroke` fallback for the visible-outline band, and
 * connectors via point-to-segment distance. See `element-hit.ts`.
 */
export function hitTestSlide(
  slide: Slide,
  x: number,
  y: number,
  options: HitTestSlideOptions,
): HitResult | null {
  // Connectors with attached endpoints look elements up by id. Build the
  // flat lookup once at the root so each connector hit-test doesn't
  // rebuild it. We index across the whole element tree (groups included)
  // because attached endpoints can target any element by id, regardless
  // of group depth.
  const lookup = buildElementLookup(slide.elements);
  const tolerance = options.tolerance ?? DEFAULT_HIT_TOLERANCE;
  return hitTestRecursive(slide.elements, x, y, [], {
    ctx: options.ctx,
    tolerance,
    lookup,
  });
}

interface InternalOptions {
  ctx: HitTestCtx;
  tolerance: number;
  lookup: ReadonlyMap<string, Element>;
}

function hitTestRecursive(
  elements: Element[],
  x: number,
  y: number,
  ancestors: string[],
  options: InternalOptions,
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
        options,
      );
      if (hit) return hit;
      continue;
    }

    if (
      hitTestElement(el, x, y, options.ctx, {
        tolerance: options.tolerance,
        elements: options.lookup,
      })
    ) {
      return { elementId: el.id, ancestorPath: [...ancestors, el.id] };
    }
  }

  return null;
}

function buildElementLookup(
  elements: readonly Element[],
): ReadonlyMap<string, Element> {
  const map = new Map<string, Element>();
  collect(elements, map);
  return map;
}

function collect(
  elements: readonly Element[],
  out: Map<string, Element>,
): void {
  for (const el of elements) {
    out.set(el.id, el);
    if (el.type === 'group') collect(el.data.children, out);
  }
}
