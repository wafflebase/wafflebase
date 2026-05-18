import type { Element } from '../../../model/element';
import type { SlidesStore } from '../../../store/store';

/**
 * Pure: apply a (dx, dy) translation to a single element. Returns a
 * shallow-cloned element (callers can pass through their own state
 * without worrying about input aliasing).
 *
 * For connectors, the cached `frame` is derived from endpoints — we
 * translate every `kind: 'free'` endpoint and let attached endpoints
 * stay anchored to their host. The frame is translated too so that
 * any caller using it for hit-tests or bbox math stays consistent
 * with the renderer (which reads endpoints).
 */
export function translateElement(
  el: Element, dx: number, dy: number,
): Element {
  if (el.type === 'connector') {
    return {
      ...el,
      start: el.start.kind === 'free'
        ? { kind: 'free', x: el.start.x + dx, y: el.start.y + dy }
        : el.start,
      end: el.end.kind === 'free'
        ? { kind: 'free', x: el.end.x + dx, y: el.end.y + dy }
        : el.end,
      frame: { ...el.frame, x: el.frame.x + dx, y: el.frame.y + dy },
    };
  }
  return {
    ...el,
    frame: { ...el.frame, x: el.frame.x + dx, y: el.frame.y + dy },
  };
}

/**
 * Commit a (dx, dy) translation to the store. Routes connectors to
 * `updateConnectorEndpoint` because their `frame` is derived state —
 * `updateElementFrame` would (correctly) throw. Attached endpoints are
 * left in place; the store recomputes the cached connector frame from
 * the surviving endpoints.
 *
 * Must be called inside a `store.batch(...)`.
 */
export function commitTranslate(
  store: SlidesStore, slideId: string, el: Element,
  dx: number, dy: number,
): void {
  if (dx === 0 && dy === 0) return;
  if (el.type === 'connector') {
    for (const side of ['start', 'end'] as const) {
      const ep = side === 'start' ? el.start : el.end;
      if (ep.kind === 'free') {
        store.updateConnectorEndpoint(slideId, el.id, side, {
          kind: 'free', x: ep.x + dx, y: ep.y + dy,
        });
      }
    }
    return;
  }
  store.updateElementFrame(slideId, el.id, {
    x: el.frame.x + dx,
    y: el.frame.y + dy,
  });
}
