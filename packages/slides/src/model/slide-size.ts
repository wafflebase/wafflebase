import type { Element } from './element';
import type { Endpoint } from './connector';

/**
 * Scale a connector endpoint's y by `factor`; attached endpoints (which
 * track their element) are returned unchanged.
 */
export function scaleEndpointY(ep: Endpoint, factor: number): Endpoint {
  return ep.kind === 'free' ? { ...ep, y: ep.y * factor } : ep;
}

/**
 * Scale one top-level element vertically **in place** by `factor` for a
 * deck-height change (see `SlidesStore.setSlideHeight`). Mutation (rather
 * than immutable replacement) so the one helper drives both the plain
 * `MemSlidesStore` model and the live Yorkie CRDT proxy — keeping the two
 * store paths from diverging.
 *
 * Per type:
 *  - connector — scale free endpoints' y (frame is recomputed by the
 *    caller from endpoints after all elements have moved);
 *  - group — pin `data.refSize` to the pre-scale frame when absent, so
 *    growing `frame.h` scales every child through the frame→refSize
 *    transform (no recursion needed);
 *  - table — scale each row height alongside `frame.h`;
 *  - everything else — scale `frame.y` / `frame.h`.
 *
 * Width is never touched — `SLIDE_WIDTH` is fixed.
 */
export function scaleElementHeight(el: Element, factor: number): void {
  if (el.type === 'connector') {
    el.start = scaleEndpointY(el.start, factor);
    el.end = scaleEndpointY(el.end, factor);
    return;
  }
  if (el.type === 'group' && el.data.refSize == null) {
    el.data.refSize = { w: el.frame.w, h: el.frame.h };
  }
  el.frame = { ...el.frame, y: el.frame.y * factor, h: el.frame.h * factor };
  if (el.type === 'table') {
    for (const row of el.data.rows) row.height = row.height * factor;
  }
}
