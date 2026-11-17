import type { Element } from '../../../model/element';
import { containsPoint } from '../../../model/frame';
import {
  getConnectionSites,
  siteWorldPos,
} from '../../canvas/connection-sites';
import { OPEN_PATH_KINDS } from '../../canvas/shape-renderer';

/**
 * Body glue for connector endpoints.
 *
 * A connector endpoint used to attach only when it was dropped within
 * `SITE_SNAP_RADIUS` of a connection site. Dropped anywhere else on a
 * shape it stayed `free`, so moving the shape left the arrow behind.
 * PowerPoint, Google Slides and FigJam all treat "released over the
 * shape" as "connect to it": the shape highlights and the endpoint glues
 * to its nearest connection site.
 *
 * Design choice: glue to the NEAREST EXISTING SITE (an ordinary
 * `attached` endpoint) rather than adding a floating "auto" site that
 * re-picks its side as the shape moves. The nearest-site rule needs no
 * model or CRDT change, round-trips through PPTX as a real
 * `<a:stCxn idx>`, and stays glued on move because attached endpoints
 * are resolved from the target's frame at paint time. The cost is that
 * the side is fixed at drop time; re-dragging the endpoint re-picks it.
 */

/**
 * Whether `el`'s body (not only its sites) accepts a dropped endpoint.
 *
 * Shapes only — the sticky notes, rectangles and ellipses a user means
 * to connect. Excluded:
 * - connectors (no sites);
 * - `freeform` strokes and open-path kinds, whose bbox is mostly empty
 *   space (a scribble's frame would swallow every endpoint near it);
 * - text, image, table, chart and group, which keep site-only snapping.
 *   On slides those are routinely slide-sized (body placeholders,
 *   full-bleed photos), so body glue there would capture nearly every
 *   endpoint drawn on top of them.
 */
export function acceptsBodyGlue(el: Element): boolean {
  if (el.type !== 'shape') return false;
  if (el.data.kind === 'freeform') return false;
  if (OPEN_PATH_KINDS.has(el.data.kind)) return false;
  return true;
}

/** Index of the connection site on `el` closest to `cursor`. */
export function nearestSiteIndex(
  el: Element,
  cursor: { x: number; y: number },
): number {
  const sites = getConnectionSites(el);
  let best = -1;
  let bestD2 = Infinity;
  for (let i = 0; i < sites.length; i++) {
    const s = siteWorldPos(el, sites[i]);
    const d2 = (s.x - cursor.x) ** 2 + (s.y - cursor.y) ** 2;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = i;
    }
  }
  return best;
}

export interface BodyGlueHit {
  elementId: string;
  siteIndex: number;
  worldX: number;
  worldY: number;
}

/**
 * The topmost body-glue-eligible element whose frame contains `cursor`,
 * with its nearest connection site. `excludeId` drops one element from
 * consideration — callers pass the element the connector's OTHER
 * endpoint is already attached to, so a short drag inside one shape does
 * not glue both ends to it (a zero-length self-loop). Deliberate site
 * snapping (`findSnapTarget`) is unaffected by the exclusion.
 *
 * `elements` is in z-order (last = topmost), as `slide.elements` is.
 */
export function findBodyGlue(
  cursor: { x: number; y: number },
  elements: readonly Element[],
  excludeId?: string,
): BodyGlueHit | null {
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (el.id === excludeId) continue;
    if (!acceptsBodyGlue(el)) continue;
    if (!containsPoint(el.frame, cursor.x, cursor.y)) continue;
    const siteIndex = nearestSiteIndex(el, cursor);
    if (siteIndex < 0) continue;
    const pos = siteWorldPos(el, getConnectionSites(el)[siteIndex]);
    return { elementId: el.id, siteIndex, worldX: pos.x, worldY: pos.y };
  }
  return null;
}
