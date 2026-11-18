import type { Element } from '../../../model/element';
import type { Point } from './insert';
import { isFreeformShape, segmentHitsFreeform } from '../freeform-hit';

/**
 * Free-form lasso: a drawn loop instead of a dragged rectangle (FigJam,
 * Miro). The board turns it on through the `freeLasso` host option;
 * Slides keeps the rectangle.
 *
 * What it picks (see {@link selectInPolygon}):
 *
 * - an element whose frame CENTRE lies inside the loop. The centre, not
 *   bbox intersection, because a loop is drawn around things; a rect
 *   lasso that merely grazes a corner picks it, a loop that grazes one
 *   should not.
 * - a freehand stroke whose painted line the loop's outline CROSSES. A
 *   long stroke's centre may sit far outside the part the user circled;
 *   cutting across it is how FigJam's lasso takes a stroke.
 */

/** Even–odd point-in-polygon. A loop is implicitly closed. */
export function pointInPolygon(p: Point, polygon: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.y > p.y !== b.y > p.y) {
      const x = ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
      if (p.x < x) inside = !inside;
    }
  }
  return inside;
}

/**
 * Ids of the top-level `elements` the loop `polygon` (world points)
 * selects. `radius` widens the outline for the stroke-crossing test, in
 * world units. Fewer than three points select nothing.
 */
export function selectInPolygon(
  elements: readonly Element[],
  polygon: readonly Point[],
  radius = 0,
): string[] {
  if (polygon.length < 3) return [];
  const ids: string[] = [];
  for (const el of elements) {
    const f = el.frame;
    const centre = { x: f.x + f.w / 2, y: f.y + f.h / 2 };
    if (pointInPolygon(centre, polygon)) {
      ids.push(el.id);
      continue;
    }
    if (!isFreeformShape(el)) continue;
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i];
      const b = polygon[(i + 1) % polygon.length];
      if (segmentHitsFreeform(el, a, b, radius)) {
        ids.push(el.id);
        break;
      }
    }
  }
  return ids;
}

/** Axis-aligned bounds of a loop (for a host's rect-based lasso filter). */
export function polygonBounds(polygon: readonly Point[]): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of polygon) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface FreeLassoHost {
  overlay: HTMLElement;
  clientToLogical(clientX: number, clientY: number): Point;
  /** World → overlay-local CSS px. */
  toOverlay(p: Point): Point;
  /** World units → CSS px. */
  scale(): number;
  color: string;
  fill: string;
  /** The loop closed: select from it. */
  finish(polygon: Point[]): void;
  /** A click without travel: what an empty-canvas click does. */
  click(): void;
  /** Register the abort hook the editor calls on pointercancel / long-press. */
  setAbort(abort: (() => void) | null): void;
}

/** Below this travel in SCREEN px the gesture is a click, not a loop. */
const MIN_TRAVEL_SCREEN_PX = 4;

/**
 * Run one lasso loop from `clientX/Y` until pointerup. The loop is drawn
 * as a dashed SVG polygon on the overlay, re-projected on every move so a
 * zoom mid-gesture keeps it under the pointer.
 */
export function captureFreeLasso(host: FreeLassoHost, clientX: number, clientY: number): void {
  const points: Point[] = [host.clientToLogical(clientX, clientY)];
  let travel = 0;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.position = 'absolute';
  svg.style.left = '0';
  svg.style.top = '0';
  svg.style.width = '100%';
  svg.style.height = '100%';
  svg.style.overflow = 'visible';
  svg.style.pointerEvents = 'none';
  const poly = document.createElementNS(SVG_NS, 'polygon');
  poly.setAttribute('fill', host.fill);
  poly.setAttribute('stroke', host.color);
  poly.setAttribute('stroke-width', '1');
  poly.setAttribute('stroke-dasharray', '4 3');
  poly.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(poly);
  host.overlay.appendChild(svg);

  const draw = (): void => {
    poly.setAttribute(
      'points',
      points
        .map((p) => {
          const o = host.toOverlay(p);
          return `${o.x.toFixed(1)},${o.y.toFixed(1)}`;
        })
        .join(' '),
    );
  };
  draw();

  const onMove = (ev: PointerEvent): void => {
    const samples =
      typeof ev.getCoalescedEvents === 'function' ? ev.getCoalescedEvents() : [];
    const step = 2 / host.scale();
    for (const s of samples.length > 0 ? samples : [ev]) {
      const p = host.clientToLogical(s.clientX, s.clientY);
      const last = points[points.length - 1];
      const d = Math.hypot(p.x - last.x, p.y - last.y);
      if (d < step) continue;
      travel += d;
      points.push(p);
    }
    draw();
  };
  const teardown = (): void => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', abort);
    host.setAbort(null);
    svg.remove();
  };
  const abort = (): void => teardown();
  const onUp = (): void => {
    teardown();
    if (travel * host.scale() < MIN_TRAVEL_SCREEN_PX || points.length < 3) {
      host.click();
      return;
    }
    host.finish(points);
  };
  host.setAbort(abort);
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', abort);
}
