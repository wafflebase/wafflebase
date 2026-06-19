import type { Element, ElementInit } from '../../../model/element';
import type { Endpoint } from '../../../model/connector';
import type { SlidesStore } from '../../../store/store';

/**
 * Shift a connector endpoint by `(dx, dy)`. A `free` endpoint carries its
 * own coordinates (the connector frame is derived from them, so offsetting
 * `frame` alone is discarded by `computeConnectorFrame`) and must be moved
 * explicitly. An `attached` endpoint follows its shape, which is offset on
 * its own, so it is left untouched.
 */
function shiftEndpoint(ep: Endpoint, dx: number, dy: number): Endpoint {
  return ep.kind === 'free' ? { ...ep, x: ep.x + dx, y: ep.y + dy } : ep;
}

/**
 * Source element for a paste. Cmd+D passes live {@link Element}s straight
 * from the selection; Cmd+V passes clipboard payloads. Both carry an `id`
 * (the clipboard serializer preserves it precisely so connector endpoints
 * can be remapped here) which keys the old→new id map below.
 */
export type PasteSource = Element;

/**
 * Insert copies of `sources` onto `slideId`, offset by `(dx, dy)`, and
 * remap attached connector endpoints so a connector pasted together with
 * its endpoint shapes follows the new copies instead of the originals.
 *
 * Without this remap, `store.addElement` assigns each copy a fresh id but
 * leaves a connector's `start.elementId` / `end.elementId` pointing at the
 * source shapes — so a pasted arrow visually snaps back onto the originals.
 *
 * An attached endpoint whose target is **not** part of `sources` is left
 * untouched (it keeps referencing the existing element).
 * `updateConnectorEndpoint` recomputes the connector frame from the new
 * endpoints.
 *
 * Must be called inside `store.batch()`. Returns the new ids in source order.
 */
export function pasteElements(
  store: SlidesStore,
  slideId: string,
  sources: readonly PasteSource[],
  dx: number,
  dy: number,
): string[] {
  const idMap = new Map<string, string>();
  const newIds: string[] = [];

  // Pass 1 — insert every element, recording source id → new id.
  for (const src of sources) {
    let init = {
      ...src,
      frame: { ...src.frame, x: src.frame.x + dx, y: src.frame.y + dy },
    } as ElementInit;
    // A connector's frame is recomputed from its endpoints on insert, so the
    // frame offset above is discarded for connectors — shift the free
    // endpoints directly so a standalone line/arrow lands offset like every
    // other pasted element.
    if (src.type === 'connector') {
      init = {
        ...init,
        start: shiftEndpoint(src.start, dx, dy),
        end: shiftEndpoint(src.end, dx, dy),
      } as ElementInit;
    }
    const newId = store.addElement(slideId, init);
    newIds.push(newId);
    idMap.set(src.id, newId);
  }

  // Pass 2 — rewrite attached connector endpoints to the pasted copies.
  // Done after pass 1 so the map covers every pasted element regardless of
  // order, and so the remapped target shapes already exist for the frame
  // recompute inside updateConnectorEndpoint.
  sources.forEach((src, i) => {
    if (src.type !== 'connector') return;
    const newId = newIds[i];
    for (const side of ['start', 'end'] as const) {
      const ep = src[side];
      if (ep.kind !== 'attached') continue;
      const mapped = idMap.get(ep.elementId);
      if (mapped === undefined) continue; // target outside the paste set
      store.updateConnectorEndpoint(slideId, newId, side, {
        ...ep,
        elementId: mapped,
      });
    }
  });

  return newIds;
}
