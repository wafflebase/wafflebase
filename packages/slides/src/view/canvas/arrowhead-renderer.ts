import type { ArrowheadStyle } from '../../model/connector';

/**
 * An endpoint where an arrowhead is drawn. `angle` is the path tangent in
 * radians pointing AWAY from the connector body (out of the endpoint), so
 * the triangle's tip lands on `(x, y)` and its base extends backward into
 * the body.
 */
export type ArrowheadEndpoint = { x: number; y: number; angle: number };

const TRIANGLE_LEN: Record<ArrowheadStyle['size'], number> = {
  sm: 8,
  md: 12,
  lg: 18,
};

const TRIANGLE_WIDTH: Record<ArrowheadStyle['size'], number> = {
  sm: 6,
  md: 10,
  lg: 14,
};

/**
 * Draws an arrowhead at `ep`, pointing along `ep.angle`. The triangle's
 * tip lands on the endpoint and its base extends backward (opposite of
 * `angle`) into the connector body.
 *
 * PR1 only supports `kind: 'triangle'`. Other kinds (open/diamond/circle/
 * square variants) are accepted by the type but render nothing — they are
 * deferred to PR3.
 */
export function drawArrowhead(
  ctx: CanvasRenderingContext2D,
  ep: ArrowheadEndpoint,
  style: ArrowheadStyle,
  fillColor: string,
): void {
  if (style.kind !== 'triangle') return;

  const len = TRIANGLE_LEN[style.size];
  const halfW = TRIANGLE_WIDTH[style.size] / 2;
  const cos = Math.cos(ep.angle);
  const sin = Math.sin(ep.angle);

  // Centre of the triangle's base, one `len` back from the tip.
  const baseX = ep.x - cos * len;
  const baseY = ep.y - sin * len;

  // Perpendicular unit vector for the two base corners.
  const px = -sin;
  const py = cos;

  ctx.beginPath();
  ctx.moveTo(ep.x, ep.y);
  ctx.lineTo(baseX + px * halfW, baseY + py * halfW);
  ctx.lineTo(baseX - px * halfW, baseY - py * halfW);
  ctx.closePath();
  ctx.fillStyle = fillColor;
  ctx.fill();
}
