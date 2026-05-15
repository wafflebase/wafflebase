import type { ConnectorElement, Endpoint } from '../../model/connector';
import type { Element, Frame } from '../../model/element';
import { getConnectionSites, siteWorldPos } from './connection-sites';
import type { Point } from './routing';

/**
 * Resolve a connector endpoint to a slide-logical point.
 *
 * Free endpoints carry their position directly. Attached endpoints are
 * dereferenced through the given lookup map; if the referenced element no
 * longer exists, the caller's bbox still snaps to a defined location, so
 * we fall back to the origin rather than throwing.
 */
export function resolveEndpoint(
  ep: Endpoint,
  elements: ReadonlyMap<string, Element>,
): Point {
  if (ep.kind === 'free') return { x: ep.x, y: ep.y };
  const target = elements.get(ep.elementId);
  if (!target) return { x: 0, y: 0 };
  const sites = getConnectionSites(target);
  const site = sites[ep.siteIndex] ?? sites[0];
  const w = siteWorldPos(target, site);
  return { x: w.x, y: w.y };
}

/**
 * Derive a connector's `frame` from its endpoints — the tight bbox of the
 * two resolved endpoints, expanded by stroke half-width so the rendered
 * stroke stays inside the cached frame. PR1 keeps the bbox routing-agnostic
 * (good enough for straight connectors and a safe over-approximation for
 * future elbow/curved routings); PR2 can tighten it per-routing if needed.
 */
export function computeConnectorFrame(
  connector: ConnectorElement,
  elements: ReadonlyMap<string, Element>,
): Frame {
  const a = resolveEndpoint(connector.start, elements);
  const b = resolveEndpoint(connector.end, elements);
  const minX = Math.min(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxX = Math.max(a.x, b.x);
  const maxY = Math.max(a.y, b.y);
  const pad = (connector.stroke?.width ?? 1) / 2;
  return {
    x: minX - pad,
    y: minY - pad,
    w: maxX - minX + pad * 2,
    h: maxY - minY + pad * 2,
    rotation: 0,
  };
}
