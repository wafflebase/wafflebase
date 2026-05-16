import type { ConnectorElement } from '../../model/connector';
import type { Element } from '../../model/element';
import { type Theme } from '../../model/theme';
import { resolveStrokeColor } from './render-context';
import { drawArrowhead } from './arrowhead-renderer';
import { resolveEndpoint } from './connector-frame';
import { routeStraight } from './routing';

/**
 * Draws a connector by resolving its endpoints, routing the path between
 * them, stroking the segments, and finally drawing arrowheads aligned with
 * the local path tangent at each endpoint.
 *
 * PR1 only supports straight routing. Endpoints are already in world
 * coordinates, so the caller MUST NOT apply the per-element frame translate
 * /rotation transform — drawConnector paints into the slide-logical
 * coordinate space directly.
 */
export function drawConnector(
  ctx: CanvasRenderingContext2D,
  el: ConnectorElement,
  elements: ReadonlyMap<string, Element>,
  theme: Theme,
): void {
  const a = resolveEndpoint(el.start, elements);
  const b = resolveEndpoint(el.end, elements);

  // PR1: straight routing only. Elbow/curved arrive in PR2.
  const path = routeStraight(a, b);

  const stroke = el.stroke ?? {
    color: { kind: 'role' as const, role: 'text' as const },
    width: 2,
  };
  const strokeColor = resolveStrokeColor(stroke.color, theme);

  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = stroke.width;
  ctx.beginPath();
  ctx.moveTo(path.points[0].x, path.points[0].y);
  for (let i = 1; i < path.points.length; i++) {
    ctx.lineTo(path.points[i].x, path.points[i].y);
  }
  ctx.stroke();

  // Arrowheads use the local path tangent at each endpoint, pointing AWAY
  // from the connector body so the triangle's tip lands on the endpoint
  // and the base extends back along the path.
  const tangentAtEnd = Math.atan2(b.y - a.y, b.x - a.x);
  const tangentAtStart = tangentAtEnd + Math.PI;
  if (el.arrowheads.start) {
    drawArrowhead(
      ctx,
      { x: a.x, y: a.y, angle: tangentAtStart },
      el.arrowheads.start,
      strokeColor,
    );
  }
  if (el.arrowheads.end) {
    drawArrowhead(
      ctx,
      { x: b.x, y: b.y, angle: tangentAtEnd },
      el.arrowheads.end,
      strokeColor,
    );
  }
}
