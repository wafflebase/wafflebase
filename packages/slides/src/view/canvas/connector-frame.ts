import type { ConnectorElement, Endpoint } from '../../model/connector';
import type { Element, Frame } from '../../model/element';
import { getConnectionSites, siteWorldPos } from './connection-sites';
import {
  type BezierPath,
  type ConnectorPath,
  type Point,
  isBezierPath,
  routeCurved,
  routeElbow,
  routeStraight,
} from './routing';

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
 * Resolve a connector endpoint to a point AND an outward-normal angle.
 *
 * Attached endpoints carry their site's angle (rotated into world coords by
 * `siteWorldPos`). Free endpoints derive the exit direction by pointing at
 * `other` — `atan2(other.y - self.y, other.x - self.x)`. When `other` is
 * not supplied (or coincides), the angle falls back to `0` (east), which
 * the routing functions handle gracefully.
 */
export function resolveEndpointWithDir(
  ep: Endpoint,
  elements: ReadonlyMap<string, Element>,
  other?: Point,
): { x: number; y: number; angle: number } {
  if (ep.kind === 'attached') {
    const target = elements.get(ep.elementId);
    if (target) {
      const sites = getConnectionSites(target);
      const site = sites[ep.siteIndex] ?? sites[0];
      return siteWorldPos(target, site);
    }
    // Attached-to-deleted: fall back to the origin and aim at `other`.
    return { x: 0, y: 0, angle: other ? Math.atan2(other.y - 0, other.x - 0) : 0 };
  }
  const x = ep.x;
  const y = ep.y;
  const angle = other ? Math.atan2(other.y - y, other.x - x) : 0;
  return { x, y, angle };
}

/**
 * Resolve both endpoints and pick the right routing path. Centralised so
 * the renderer, the hit-tester, and `computeConnectorFrame` all see the
 * same geometry.
 */
export function buildConnectorPath(
  connector: ConnectorElement,
  elements: ReadonlyMap<string, Element>,
): ConnectorPath {
  if (connector.routing === 'straight') {
    const a = resolveEndpoint(connector.start, elements);
    const b = resolveEndpoint(connector.end, elements);
    return routeStraight(a, b);
  }
  // Curved / elbow need exit directions; resolve each endpoint with the
  // other's resolved position as the "other" fallback for free endpoints.
  const aPos = resolveEndpoint(connector.start, elements);
  const bPos = resolveEndpoint(connector.end, elements);
  const a = resolveEndpointWithDir(connector.start, elements, bPos);
  const b = resolveEndpointWithDir(connector.end, elements, aPos);
  if (connector.routing === 'curved') {
    return routeCurved(
      { x: a.x, y: a.y },
      a.angle,
      { x: b.x, y: b.y },
      b.angle,
      connector.curveBend,
    );
  }
  return routeElbow(
    { x: a.x, y: a.y },
    a.angle,
    { x: b.x, y: b.y },
    b.angle,
    connector.elbowBend,
  );
}

/**
 * Derive a connector's `frame` from its rendered path — the tight bbox of
 * the polyline (straight / elbow) or the cubic bezier sampled at its
 * parametric extrema (curved), expanded by stroke half-width so the
 * rendered stroke stays inside the cached frame.
 */
export function computeConnectorFrame(
  connector: ConnectorElement,
  elements: ReadonlyMap<string, Element>,
): Frame {
  const path = buildConnectorPath(connector, elements);
  const bbox = isBezierPath(path) ? bezierBBox(path) : polylineBBox(path.points);
  const pad = (connector.stroke?.width ?? 1) / 2;
  return {
    x: bbox.minX - pad,
    y: bbox.minY - pad,
    w: bbox.maxX - bbox.minX + pad * 2,
    h: bbox.maxY - bbox.minY + pad * 2,
    rotation: 0,
  };
}

type BBox = { minX: number; minY: number; maxX: number; maxY: number };

function polylineBBox(points: readonly Point[]): BBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Tight AABB of a cubic bezier. Includes the endpoints and any parametric
 * extrema in (0, 1) — roots of the derivative on each axis.
 */
function bezierBBox(b: BezierPath): BBox {
  let minX = Math.min(b.p0.x, b.p1.x);
  let minY = Math.min(b.p0.y, b.p1.y);
  let maxX = Math.max(b.p0.x, b.p1.x);
  let maxY = Math.max(b.p0.y, b.p1.y);
  for (const t of cubicExtrema(b.p0.x, b.c1.x, b.c2.x, b.p1.x)) {
    const x = cubicAt(b.p0.x, b.c1.x, b.c2.x, b.p1.x, t);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
  }
  for (const t of cubicExtrema(b.p0.y, b.c1.y, b.c2.y, b.p1.y)) {
    const y = cubicAt(b.p0.y, b.c1.y, b.c2.y, b.p1.y, t);
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Roots of the derivative of `B(t) = (1-t)^3·p0 + 3(1-t)^2·t·c1 +
 * 3(1-t)·t^2·c2 + t^3·p1`, filtered to (0, 1). Used to find parametric
 * extrema; endpoints are handled separately.
 */
function cubicExtrema(
  p0: number, c1: number, c2: number, p1: number,
): number[] {
  // B'(t) = 3·[(1-t)^2·(c1-p0) + 2·(1-t)·t·(c2-c1) + t^2·(p1-c2)]
  // Expand to At^2 + Bt + C = 0.
  const A = -p0 + 3 * c1 - 3 * c2 + p1;
  const B = 2 * (p0 - 2 * c1 + c2);
  const C = c1 - p0;
  const roots: number[] = [];
  if (Math.abs(A) < 1e-12) {
    if (Math.abs(B) > 1e-12) {
      const t = -C / B;
      if (t > 0 && t < 1) roots.push(t);
    }
    return roots;
  }
  const disc = B * B - 4 * A * C;
  if (disc < 0) return roots;
  const sq = Math.sqrt(disc);
  for (const t of [(-B + sq) / (2 * A), (-B - sq) / (2 * A)]) {
    if (t > 0 && t < 1) roots.push(t);
  }
  return roots;
}

function cubicAt(p0: number, c1: number, c2: number, p1: number, t: number): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * c1 + 3 * u * t * t * c2 + t * t * t * p1;
}
