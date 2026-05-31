import type { ConnectorElement } from '../../model/connector';
import type { Element } from '../../model/element';
import { type Theme } from '../../model/theme';
import { resolveStrokeColor } from './render-context';
import { drawArrowhead } from './arrowhead-renderer';
import { buildConnectorPath } from './connector-frame';
import { type BezierPath, type Point, isBezierPath } from './routing';

/**
 * Draws a connector by resolving its endpoints, routing the path between
 * them (straight / elbow polyline / cubic bezier), stroking the path, and
 * finally drawing arrowheads aligned with the path-local tangent at each
 * endpoint.
 *
 * Endpoints are already in world coordinates, so the caller MUST NOT apply
 * the per-element frame transform — `drawConnector` paints into the slide-
 * logical coordinate space directly.
 */
export function drawConnector(
  ctx: CanvasRenderingContext2D,
  el: ConnectorElement,
  elements: ReadonlyMap<string, Element>,
  theme: Theme,
): void {
  const path = buildConnectorPath(el, elements);

  const stroke = el.stroke ?? {
    color: { kind: 'role' as const, role: 'text' as const },
    width: 2,
  };
  const strokeColor = resolveStrokeColor(stroke.color, theme);

  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = stroke.width;
  ctx.beginPath();
  if (isBezierPath(path)) {
    ctx.moveTo(path.p0.x, path.p0.y);
    ctx.bezierCurveTo(path.c1.x, path.c1.y, path.c2.x, path.c2.y, path.p1.x, path.p1.y);
  } else {
    ctx.moveTo(path.points[0].x, path.points[0].y);
    for (let i = 1; i < path.points.length; i++) {
      ctx.lineTo(path.points[i].x, path.points[i].y);
    }
  }
  ctx.stroke();

  // Arrowheads use the path-local tangent at each endpoint, pointing AWAY
  // from the connector body so the triangle's tip lands on the endpoint
  // and the base extends back along the path. For a polyline the tangent
  // is the first / last segment's direction; for a bezier we differentiate
  // at t=0 / t=1.
  const start = endpointPose(path, 'start');
  const end = endpointPose(path, 'end');
  if (el.arrowheads.start) {
    drawArrowhead(ctx, start, el.arrowheads.start, strokeColor);
  }
  if (el.arrowheads.end) {
    drawArrowhead(ctx, end, el.arrowheads.end, strokeColor);
  }
}

/**
 * World position + outgoing-from-path-body tangent at the requested
 * endpoint. For arrowhead rendering: tangent points AWAY from the
 * connector body so the arrowhead base lies along the path.
 */
function endpointPose(
  path: ReturnType<typeof buildConnectorPath>,
  which: 'start' | 'end',
): { x: number; y: number; angle: number } {
  if (isBezierPath(path)) {
    return bezierEndpointPose(path, which);
  }
  const pts = path.points;
  if (which === 'start') {
    const p0 = pts[0];
    const p1 = nextDistinct(pts, 0, 1) ?? pts[pts.length - 1];
    // Arrowhead points away from body → reverse the path tangent.
    return { x: p0.x, y: p0.y, angle: Math.atan2(p0.y - p1.y, p0.x - p1.x) };
  }
  const pEnd = pts[pts.length - 1];
  const pPrev = nextDistinct(pts, pts.length - 1, -1) ?? pts[0];
  return { x: pEnd.x, y: pEnd.y, angle: Math.atan2(pEnd.y - pPrev.y, pEnd.x - pPrev.x) };
}

function bezierEndpointPose(
  b: BezierPath,
  which: 'start' | 'end',
): { x: number; y: number; angle: number } {
  if (which === 'start') {
    // B'(0) = 3 * (c1 - p0); reversed for "away from body".
    const tx = 3 * (b.c1.x - b.p0.x);
    const ty = 3 * (b.c1.y - b.p0.y);
    const angle =
      tx === 0 && ty === 0
        ? Math.atan2(b.p0.y - b.p1.y, b.p0.x - b.p1.x)
        : Math.atan2(-ty, -tx);
    return { x: b.p0.x, y: b.p0.y, angle };
  }
  // B'(1) = 3 * (p1 - c2).
  const tx = 3 * (b.p1.x - b.c2.x);
  const ty = 3 * (b.p1.y - b.c2.y);
  const angle =
    tx === 0 && ty === 0
      ? Math.atan2(b.p1.y - b.p0.y, b.p1.x - b.p0.x)
      : Math.atan2(ty, tx);
  return { x: b.p1.x, y: b.p1.y, angle };
}

/**
 * Walk the polyline from `from` in `step` direction (±1) and return the
 * first point whose coordinates differ from `points[from]`. Skips the
 * duplicate corner points that some routings emit.
 */
function nextDistinct(
  points: readonly Point[],
  from: number,
  step: 1 | -1,
): Point | undefined {
  const anchor = points[from];
  for (let i = from + step; i >= 0 && i < points.length; i += step) {
    const p = points[i];
    if (p.x !== anchor.x || p.y !== anchor.y) return p;
  }
  return undefined;
}
