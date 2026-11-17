import type { ConnectorElement, Endpoint } from '../../../model/connector';
import type { Element } from '../../../model/element';
import type { SlidesStore } from '../../../store/store';
import {
  getConnectionSites,
  siteWorldPos,
} from '../../canvas/connection-sites';
import { computeConnectorFrame } from '../../canvas/connector-frame';
import { findBodyGlue } from './connector-glue';

/**
 * Connector-insert variants exposed to the editor:
 *   - `'line'`   — straight line, no arrowheads.
 *   - `'arrow'`  — straight line, triangle arrowhead at `end`.
 *   - `'elbow'`  — Manhattan-routed elbow with an end arrowhead.
 *   - `'curved'` — cubic-bezier connector with an end arrowhead.
 * Maps directly to the toolbar `'connector:line'` / `'connector:arrow'`
 * / `'connector:elbow'` / `'connector:curved'` insert-mode keys.
 */
export type ConnectorInsertVariant = 'line' | 'arrow' | 'elbow' | 'curved';

/**
 * Distance (in screen pixels, DPR-corrected at draw time) within which
 * a cursor counts as "over" a shape for connection-points display.
 * Callers convert to slide-logical distance by dividing by the current
 * `zoom` so the affordance feels the same to the user at any zoom
 * level. Consumed by the overlay (Task 13) and the snap helpers below;
 * exported so both stay in sync.
 */
export const SHAPE_HOVER_RADIUS = 24;

/**
 * Distance (in screen pixels) within which the cursor snaps to a
 * connection site. Smaller than `SHAPE_HOVER_RADIUS` so the user sees
 * the dots first, then has to deliberately move closer to commit to a
 * snap. Like `SHAPE_HOVER_RADIUS`, this is a screen-pixel constant —
 * callers divide by `zoom` to get the slide-logical threshold.
 */
export const SITE_SNAP_RADIUS = 12;

/**
 * Minimum drag distance (in **screen pixels**, like `SHAPE_HOVER_RADIUS`
 * and `SITE_SNAP_RADIUS`) before a connector-insert commits. A click or
 * micro-drag cancels insertion — connectors with near-zero length are
 * almost always accidental. Callers convert to slide-logical distance
 * by dividing by `zoom` so the threshold feels the same at any zoom.
 */
export const MIN_DRAG_DISTANCE = 4;

export interface SnapHit {
  elementId: string;
  siteIndex: number;
  worldX: number;
  worldY: number;
}

/**
 * Find the nearest connection site to `cursor` across all candidate
 * elements. Returns null if no site is within `SITE_SNAP_RADIUS` screen
 * pixels (converted to slide-logical distance via `zoom`). Connector
 * elements have no connection sites and are skipped, so a fresh
 * connector never accidentally snaps to a sibling connector's endpoint.
 *
 * `zoom` must match the host's current scale so the snap rule agrees
 * with the overlay's highlight rule — both interpret `SITE_SNAP_RADIUS`
 * as screen pixels and apply the same `/zoom` correction.
 */
export function findSnapTarget(
  cursor: { x: number; y: number },
  elements: readonly Element[],
  zoom: number,
): SnapHit | null {
  // Guard against non-finite or non-positive zoom — division below would
  // produce NaN / Infinity and falsely match every site.
  if (!Number.isFinite(zoom) || zoom <= 0) return null;
  let best: SnapHit | null = null;
  // Constants are screen pixels; divide by zoom to get the slide-
  // logical threshold the squared comparison below works in.
  const snapLogical = SITE_SNAP_RADIUS / zoom;
  let bestD2 = snapLogical * snapLogical;
  for (const el of elements) {
    if (el.type === 'connector') continue;
    const sites = getConnectionSites(el);
    for (let i = 0; i < sites.length; i++) {
      const s = siteWorldPos(el, sites[i]);
      const dx = s.x - cursor.x;
      const dy = s.y - cursor.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = { elementId: el.id, siteIndex: i, worldX: s.x, worldY: s.y };
      }
    }
  }
  return best;
}

export interface GlueTarget extends SnapHit {
  /**
   * `'site'`: the cursor is within the snap radius of a site.
   * `'body'`: the cursor is over a shape's body and glues to its
   * nearest site (see `connector-glue.ts`).
   */
  via: 'site' | 'body';
}

export interface GlueOptions {
  /**
   * Element whose BODY must not capture this endpoint: the element the
   * connector's other endpoint is attached to. Site snapping still
   * reaches it.
   */
  excludeBodyOf?: string;
}

/**
 * Where an endpoint at `cursor` would attach: a connection site within
 * the snap radius first (unchanged precedence), else the body of the
 * topmost connectable shape under the cursor, glued to its nearest
 * site. Shared by the commit path (`snappedEndpoint`) and the overlay's
 * highlight, so what the user sees is what gets committed.
 */
export function findGlueTarget(
  cursor: { x: number; y: number },
  elements: readonly Element[],
  zoom: number,
  opts: GlueOptions = {},
): GlueTarget | null {
  const site = findSnapTarget(cursor, elements, zoom);
  if (site) return { ...site, via: 'site' };
  const body = findBodyGlue(cursor, elements, opts.excludeBodyOf);
  if (body) return { ...body, via: 'body' };
  return null;
}

/**
 * Resolve the cursor to an `Endpoint`. Attaches when `findGlueTarget`
 * finds a site (within the snap radius, or the nearest site of the shape
 * whose body is under the cursor); otherwise a `free` endpoint at the
 * raw cursor position. `zoom` is forwarded so the screen-pixel snap
 * threshold stays consistent across zoom levels.
 */
export function snappedEndpoint(
  cursor: { x: number; y: number },
  elements: readonly Element[],
  zoom: number,
  opts: GlueOptions = {},
): Endpoint {
  const hit = findGlueTarget(cursor, elements, zoom, opts);
  if (hit) {
    return { kind: 'attached', elementId: hit.elementId, siteIndex: hit.siteIndex };
  }
  return { kind: 'free', x: cursor.x, y: cursor.y };
}

/**
 * Build the `ElementInit` for a connector-insert drag — used by both
 * the live drag preview (no store mutation) and `finalizeInsert`
 * (which commits to the store). Centralising the shape keeps the
 * preview and the committed element perfectly in sync.
 */
export function buildConnectorInit(
  variant: ConnectorInsertVariant,
  start: { x: number; y: number },
  end: { x: number; y: number },
  elements: readonly Element[],
  zoom: number,
): Omit<ConnectorElement, 'id'> {
  const startEp = snappedEndpoint(start, elements, zoom);
  // A drag that starts and ends inside one shape must not glue both
  // ends to it: the end's body glue skips the start's shape.
  const endEp = snappedEndpoint(end, elements, zoom, {
    excludeBodyOf: startEp.kind === 'attached' ? startEp.elementId : undefined,
  });

  // Line is the only variant without an end arrowhead — Arrow / Elbow /
  // Curved all get an end arrowhead by default (matches Google Slides).
  const arrowheads: ConnectorElement['arrowheads'] =
    variant === 'line'
      ? {}
      : { end: { kind: 'triangle', size: 'md' } };

  const routing: ConnectorElement['routing'] =
    variant === 'elbow' ? 'elbow' : variant === 'curved' ? 'curved' : 'straight';

  const init: Omit<ConnectorElement, 'id'> = {
    type: 'connector',
    routing,
    start: startEp,
    end: endEp,
    arrowheads,
    frame: { x: 0, y: 0, w: 0, h: 0, rotation: 0 },
    stroke: { color: { kind: 'role', role: 'text' }, width: 2 },
  };
  // Pre-fill the frame so insertion-time selection bbox is correct.
  init.frame = computeConnectorFrame(
    { id: '_', ...init } as ConnectorElement,
    new Map(elements.map((e) => [e.id, e])),
  );
  return init;
}

/**
 * Finalize a connector-insert drag. Returns the new element id, or
 * null if the drag was too short to be meaningful. The store mutation
 * is wrapped in `store.batch(...)` here — colocating the transaction
 * boundary with the threshold gate means a sub-threshold click skips
 * both the mutation AND the undo-snapshot the batch would push, so a
 * stray click in connector-arm mode does not pollute the undo stack.
 * Callers are responsible for clearing insert mode after.
 */
export function finalizeInsert(
  store: SlidesStore,
  slideId: string,
  variant: ConnectorInsertVariant,
  start: { x: number; y: number },
  end: { x: number; y: number },
  elements: readonly Element[],
  zoom: number,
): string | null {
  // Guard against non-finite or non-positive zoom — the deadband below
  // would divide by zero / NaN and either reject or accept everything.
  if (!Number.isFinite(zoom) || zoom <= 0) return null;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  // `MIN_DRAG_DISTANCE` is in screen pixels; cursor deltas above are in
  // slide-logical units. Divide by zoom to get the matching logical
  // threshold so the deadband feels identical at every zoom level.
  if (Math.hypot(dx, dy) < MIN_DRAG_DISTANCE / zoom) return null;
  const init = buildConnectorInit(variant, start, end, elements, zoom);
  let id: string | null = null;
  store.batch(() => {
    id = store.addElement(slideId, init);
  });
  return id;
}
